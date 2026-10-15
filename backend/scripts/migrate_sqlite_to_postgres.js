const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');

const sqliteDbPath = path.resolve(__dirname, '../prisma/dev.db');
const pgConnStr = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/smartschool';

async function runMigration() {
  console.log('================================================================');
  console.log('🚀 MEMULAI MIGRASI LENGKAP: SQLite dev.db -> PostgreSQL 16');
  console.log('SQLite source   :', sqliteDbPath);
  console.log('Postgres target :', pgConnStr);
  console.log('================================================================\n');

  const pgClient = new Client({ connectionString: pgConnStr });
  await pgClient.connect();
  console.log('✅ Terhubung ke PostgreSQL 16.');

  const sqliteDb = new sqlite3.Database(sqliteDbPath, sqlite3.OPEN_READONLY);
  console.log('✅ Terbuka database SQLite dev.db.');

  // Disable triggers & foreign keys during bulk load
  await pgClient.query("SET session_replication_role = 'replica';");
  console.log("⚡ session_replication_role diset ke 'replica' (Foreign key check dinonaktifkan sementara).\n");

  // Helper promise wrappers for sqlite3
  const sqliteAll = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });

  const sqliteGet = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });

  // Get PostgreSQL column metadata
  const pgColumnsRes = await pgClient.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public';
  `);
  const pgTablesMeta = {};
  for (const row of pgColumnsRes.rows) {
    if (!pgTablesMeta[row.table_name]) pgTablesMeta[row.table_name] = {};
    pgTablesMeta[row.table_name][row.column_name] = {
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable === 'YES'
    };
  }

  // Get all user tables in SQLite
  const sqliteTables = await sqliteAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name;"
  );

  console.log(`Ditemukan ${sqliteTables.length} tabel di SQLite.\n`);

  let totalMigratedRows = 0;
  const tableStats = [];

  for (const t of sqliteTables) {
    const tableName = t.name;
    const pgMeta = pgTablesMeta[tableName];

    if (!pgMeta) {
      console.warn(`⚠️ Tabel "${tableName}" ada di SQLite tapi tidak ada di PostgreSQL schema, dilewati.`);
      continue;
    }

    // Get SQLite columns
    const sqCols = await sqliteAll(`PRAGMA table_info("${tableName}");`);
    const validCols = sqCols.map(c => c.name).filter(c => pgMeta[c]);

    if (validCols.length === 0) {
      continue;
    }

    // Count SQLite rows
    const countRow = await sqliteGet(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const totalRows = countRow ? countRow.cnt : 0;

    if (totalRows === 0) {
      tableStats.push({ table: tableName, sqlite: 0, pg: 0, status: 'EMPTY_OK' });
      continue;
    }

    // Check if table is already fully migrated
    const initialPgCountRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const initialPgCount = parseInt(initialPgCountRes.rows[0].cnt, 10);
    if (initialPgCount === totalRows && totalRows > 0) {
      tableStats.push({ table: tableName, sqlite: totalRows, pg: initialPgCount, status: 'MATCH' });
      console.log(`⏩ Tabel "${tableName}" sudah lengkap (${initialPgCount} baris) ✅`);
      totalMigratedRows += initialPgCount;
      continue;
    }

    if (initialPgCount > 0) {
      await pgClient.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);
    }

    process.stdout.write(`⏳ Migrasi tabel "${tableName}" (${totalRows} baris)... `);

    // Fetch all rows from SQLite
    const rows = await sqliteAll(`SELECT * FROM "${tableName}";`);

    // Prepare batch insert
    const colListStr = validCols.map(c => `"${c}"`).join(', ');
    // Wrap batch inserts in transactions to prevent per-query disk fsync
    await pgClient.query('BEGIN;');
    const batchSize = 500;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const valueClauses = [];
      const values = [];
      let paramIdx = 1;

      for (const row of chunk) {
        const rowPlaceholders = [];
        for (const col of validCols) {
          const colMeta = pgMeta[col];
          let val = row[col];

          if (val === undefined || val === null) {
            val = null;
          } else if (colMeta.dataType === 'boolean') {
            if (val === 1 || val === '1' || val === true || val === 'true') val = true;
            else if (val === 0 || val === '0' || val === false || val === 'false') val = false;
            else val = Boolean(val);
          } else if (colMeta.dataType.includes('timestamp') || colMeta.dataType === 'date') {
            if (typeof val === 'number') {
              val = new Date(val);
            } else if (typeof val === 'string') {
              const d = new Date(val);
              val = isNaN(d.getTime()) ? null : d;
            }
          } else if (colMeta.dataType === 'integer' || colMeta.dataType === 'smallint') {
            const parsed = parseInt(val, 10);
            val = isNaN(parsed) ? null : parsed;
          } else if (colMeta.dataType === 'bigint') {
            try { val = BigInt(val).toString(); } catch { val = null; }
          } else if (colMeta.dataType === 'double precision' || colMeta.dataType === 'real' || colMeta.dataType === 'numeric') {
            const parsed = parseFloat(val);
            val = isNaN(parsed) ? null : parsed;
          } else if (colMeta.dataType === 'json' || colMeta.dataType === 'jsonb') {
            if (typeof val === 'object') val = JSON.stringify(val);
            else if (typeof val === 'string') val = val.replace(/\0/g, '');
          } else {
            val = String(val).replace(/\0/g, '');
          }

          values.push(val);
          rowPlaceholders.push(`$${paramIdx++}`);
        }
        valueClauses.push(`(${rowPlaceholders.join(', ')})`);
      }

      const insertSql = `INSERT INTO "${tableName}" (${colListStr}) VALUES ${valueClauses.join(', ')} ON CONFLICT DO NOTHING;`;
      await pgClient.query(insertSql, values);

      if (i > 0 && i % 25000 === 0) {
        await pgClient.query('COMMIT;');
        await pgClient.query('BEGIN;');
      }
    }
    await pgClient.query('COMMIT;');

    // Verify row count in PostgreSQL
    const pgCountRes = await pgClient.query(`SELECT COUNT(*) as cnt FROM "${tableName}";`);
    const pgCount = parseInt(pgCountRes.rows[0].cnt, 10);

    totalMigratedRows += pgCount;
    const match = totalRows === pgCount;
    tableStats.push({ table: tableName, sqlite: totalRows, pg: pgCount, status: match ? 'MATCH' : 'DIFF' });
    console.log(`SELESAI (PG: ${pgCount} baris) ${match ? '✅' : '⚠️'}`);
  }

  // Re-enable triggers and foreign keys
  await pgClient.query("SET session_replication_role = 'origin';");
  console.log("\n⚡ session_replication_role dikembalikan ke 'origin'.");

  console.log('\n================================================================');
  console.log('📊 HASIL VERIFIKASI MIGRASI TABEL PER TABEL');
  console.log('================================================================');
  console.log(
    'Nama Tabel'.padEnd(35) +
    'SQLite'.padStart(10) +
    'Postgres'.padStart(12) +
    'Status'.padStart(12)
  );
  console.log('-'.repeat(69));

  let mismatchCount = 0;
  for (const s of tableStats) {
    if (s.sqlite > 0 || s.pg > 0) {
      const statusIcon = s.status === 'MATCH' ? '✅ MATCH' : `⚠️ DIFF (${s.pg - s.sqlite})`;
      if (s.status !== 'MATCH') mismatchCount++;
      console.log(
        s.table.padEnd(35) +
        String(s.sqlite).padStart(10) +
        String(s.pg).padStart(12) +
        statusIcon.padStart(12)
      );
    }
  }

  console.log('-'.repeat(69));
  console.log(`TOTAL BARIS TERPIGRASI KE POSTGRESQL: ${totalMigratedRows.toLocaleString()} baris`);
  console.log(`Tabel dengan ketidaksesuaian: ${mismatchCount}`);
  console.log('================================================================\n');

  sqliteDb.close();
  await pgClient.end();
}

runMigration().catch(err => {
  console.error('❌ FATAL ERROR MIGRATION:', err);
  process.exit(1);
});
