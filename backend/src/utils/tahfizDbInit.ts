import prisma from './db';

/**
 * Initialize tables for Tahfiz & Murojaah Juz 30 (PostgreSQL & SQLite compatible)
 */
export async function initTahfizTables() {
  try {
    const isPg = (process.env.DATABASE_URL || '').includes('postgres');
    const dtType = isPg ? 'TIMESTAMP' : 'DATETIME';

    // 1. Table: tahfiz_surah_master
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_surah_master (
        id INTEGER PRIMARY KEY,
        number INTEGER UNIQUE NOT NULL,
        name_latin TEXT NOT NULL,
        name_arabic TEXT NOT NULL,
        meaning TEXT NOT NULL,
        ayat_count INTEGER NOT NULL,
        place TEXT NOT NULL,
        audio_url TEXT
      );
    `);

    // 2. Table: tahfiz_target
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_target (
        id TEXT PRIMARY KEY,
        guru_id TEXT NOT NULL,
        guru_name TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'KELAS',
        class_name TEXT,
        student_id TEXT,
        student_name TEXT,
        surah_number INTEGER NOT NULL,
        surah_name TEXT NOT NULL,
        ayat_start INTEGER NOT NULL DEFAULT 1,
        ayat_end INTEGER NOT NULL,
        semester TEXT NOT NULL DEFAULT 'Ganjil',
        academic_year TEXT NOT NULL DEFAULT '2026/2027',
        deadline_date TEXT,
        status TEXT NOT NULL DEFAULT 'AKTIF',
        created_at ${dtType} DEFAULT CURRENT_TIMESTAMP,
        updated_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Table: tahfiz_setoran
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_setoran (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        surah_number INTEGER NOT NULL,
        surah_name TEXT NOT NULL,
        ayat_start INTEGER NOT NULL DEFAULT 1,
        ayat_end INTEGER NOT NULL,
        metode TEXT NOT NULL DEFAULT 'LANGSUNG',
        audio_record_url TEXT,
        submission_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'MENUNGGU',
        teacher_notes TEXT,
        created_at ${dtType} DEFAULT CURRENT_TIMESTAMP,
        updated_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Table: tahfiz_penilaian
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_penilaian (
        id TEXT PRIMARY KEY,
        setoran_id TEXT,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        guru_id TEXT NOT NULL,
        guru_name TEXT NOT NULL,
        surah_number INTEGER NOT NULL,
        surah_name TEXT NOT NULL,
        ayat_start INTEGER NOT NULL DEFAULT 1,
        ayat_end INTEGER NOT NULL,
        nilai_kelancaran REAL NOT NULL DEFAULT 0,
        bobot_kelancaran REAL NOT NULL DEFAULT 25,
        nilai_ketepatan_ayat REAL NOT NULL DEFAULT 0,
        bobot_ketepatan_ayat REAL NOT NULL DEFAULT 25,
        nilai_tajwid REAL NOT NULL DEFAULT 0,
        bobot_tajwid REAL NOT NULL DEFAULT 20,
        nilai_makharijul_huruf REAL NOT NULL DEFAULT 0,
        bobot_makharijul_huruf REAL NOT NULL DEFAULT 20,
        nilai_kemandirian REAL NOT NULL DEFAULT 0,
        bobot_kemandirian REAL NOT NULL DEFAULT 10,
        nilai_akhir REAL NOT NULL DEFAULT 0,
        status_hafalan TEXT NOT NULL DEFAULT 'SEDANG_DIHAFAL',
        catatan_guru TEXT,
        tanggal_penilaian TEXT NOT NULL,
        created_at ${dtType} DEFAULT CURRENT_TIMESTAMP,
        updated_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Table: tahfiz_murojaah
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_murojaah (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        guru_id TEXT NOT NULL,
        surah_number INTEGER NOT NULL,
        surah_name TEXT NOT NULL,
        jadwal_murojaah TEXT NOT NULL,
        hasil_uji_ulang TEXT DEFAULT 'LANCAR',
        nilai_uji_ulang REAL,
        catatan_tindak_lanjut TEXT,
        status TEXT NOT NULL DEFAULT 'TERJADWAL',
        created_at ${dtType} DEFAULT CURRENT_TIMESTAMP,
        updated_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Table: tahfiz_rubrik_config
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_rubrik_config (
        id TEXT PRIMARY KEY,
        bobot_kelancaran REAL NOT NULL DEFAULT 25,
        bobot_ketepatan_ayat REAL NOT NULL DEFAULT 25,
        bobot_tajwid REAL NOT NULL DEFAULT 20,
        bobot_makharijul_huruf REAL NOT NULL DEFAULT 20,
        bobot_kemandirian REAL NOT NULL DEFAULT 10,
        min_lulus_score REAL NOT NULL DEFAULT 75,
        updated_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Table: tahfiz_prestasi (Badges & Achievements)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tahfiz_prestasi (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        badge_code TEXT NOT NULL,
        badge_name TEXT NOT NULL,
        badge_icon TEXT NOT NULL,
        description TEXT NOT NULL,
        awarded_at ${dtType} DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed 37 Surahs of Juz 30 if empty
    const countResult: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM tahfiz_surah_master`);
    const count = Number(countResult[0]?.cnt || 0);

    if (count < 37) {
      const surahs = [
        [78, "An-Naba'", "النَّبَإِ", "Berita Besar", 40, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/078001.mp3"],
        [79, "An-Nazi'at", "النَّازِعَاتِ", "Malaikat Pencabut", 46, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/079001.mp3"],
        [80, "'Abasa", "عَبَسَ", "Ia Bermuka Masam", 42, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/080001.mp3"],
        [81, "At-Takwir", "التَّكْوِيرِ", "Menggulung", 29, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/081001.mp3"],
        [82, "Al-Infitar", "الانْفِطَارِ", "Terbelah", 19, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/082001.mp3"],
        [83, "Al-Muthaffifin", "المُطَفِّفِينَ", "Orang Curang", 36, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/083001.mp3"],
        [84, "Al-Inshiqaq", "الانْشِقَاقِ", "Terbelah", 25, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/084001.mp3"],
        [85, "Al-Buruj", "البُرُوجِ", "Gugusan Bintang", 22, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/085001.mp3"],
        [86, "At-Tariq", "الطَّارِقِ", "Bintang di Malam Hari", 17, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/086001.mp3"],
        [87, "Al-A'la", "الأَعْلَى", "Yang Maha Tinggi", 19, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/087001.mp3"],
        [88, "Al-Ghasyiyah", "الغَاشِيَةِ", "Hari Pembalasan", 26, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/088001.mp3"],
        [89, "Al-Fajr", "الفَجْرِ", "Fajar", 30, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/089001.mp3"],
        [90, "Al-Balad", "البَلَدِ", "Negeri", 20, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/090001.mp3"],
        [91, "Asy-Syams", "الشَّمْسِ", "Matahari", 15, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/091001.mp3"],
        [92, "Al-Lail", "اللَّيْلِ", "Malam", 21, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/092001.mp3"],
        [93, "Ad-Duha", "الضُّحَى", "Waktu Dhuha", 11, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/093001.mp3"],
        [94, "Asy-Syarh", "الشَّرْحِ", "Kelapangan", 8, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/094001.mp3"],
        [95, "At-Tin", "التِّينِ", "Buah Tin", 8, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/095001.mp3"],
        [96, "Al-'Alaq", "العَلَقِ", "Segumpal Darah", 19, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/096001.mp3"],
        [97, "Al-Qadr", "القَدْرِ", "Kemuliaan", 5, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/097001.mp3"],
        [98, "Al-Bayyinah", "البَيِّنَةِ", "Bukti Nyata", 8, "Madaniyah", "https://everyayah.com/data/Alafasy_128kbps/098001.mp3"],
        [99, "Az-Zalzalah", "الزَّلْزَلَةِ", "Kegoncangan", 8, "Madaniyah", "https://everyayah.com/data/Alafasy_128kbps/099001.mp3"],
        [100, "Al-'Adiyat", "العَادِيَاتِ", "Kuda Perang Berlari Kencang", 11, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/100001.mp3"],
        [101, "Al-Qari'ah", "القَارِعَةِ", "Hari Kiamat", 11, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/101001.mp3"],
        [102, "At-Takatsur", "التَّكَاثُرِ", "Bermegah-Megahan", 8, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/102001.mp3"],
        [103, "Al-'Asr", "العَصْرِ", "Masa / Waktu", 3, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/103001.mp3"],
        [104, "Al-Humazah", "الهُمَزَةِ", "Pengumpat", 9, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/104001.mp3"],
        [105, "Al-Fil", "الفِيلِ", "Gajah", 5, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/105001.mp3"],
        [106, "Quraisy", "قُرَيْشٍ", "Suku Quraisy", 4, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/106001.mp3"],
        [107, "Al-Ma'un", "المَاعُونِ", "Barang Berguna", 7, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/107001.mp3"],
        [108, "Al-Kautsar", "الكَوْثَرِ", "Nikmat Berlimpah", 3, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/108001.mp3"],
        [109, "Al-Kafirun", "الكَافِرُونَ", "Orang-Orang Kafir", 6, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/109001.mp3"],
        [110, "An-Nasr", "النَّصْرِ", "Pertolongan", 3, "Madaniyah", "https://everyayah.com/data/Alafasy_128kbps/110001.mp3"],
        [111, "Al-Lahab", "المَسَدِ", "Gejolak Api", 5, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/111001.mp3"],
        [112, "Al-Ikhlas", "الإِخْلَاصِ", "Keesaan Allah", 4, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/112001.mp3"],
        [113, "Al-Falaq", "الفَلَقِ", "Waktu Subuh", 5, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/113001.mp3"],
        [114, "An-Nas", "النَّاسِ", "Manusia", 6, "Makkiyah", "https://everyayah.com/data/Alafasy_128kbps/114001.mp3"]
      ];

      for (const s of surahs) {
        if (isPg) {
          await prisma.$executeRawUnsafe(`
            INSERT INTO tahfiz_surah_master (id, number, name_latin, name_arabic, meaning, ayat_count, place, audio_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING
          `, s[0], s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
        } else {
          await prisma.$executeRawUnsafe(`
            INSERT OR REPLACE INTO tahfiz_surah_master (id, number, name_latin, name_arabic, meaning, ayat_count, place, audio_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, s[0], s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
        }
      }
    }

    // Default rubric config
    if (isPg) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO tahfiz_rubrik_config (id, bobot_kelancaran, bobot_ketepatan_ayat, bobot_tajwid, bobot_makharijul_huruf, bobot_kemandirian, min_lulus_score)
        VALUES ('default', 25, 25, 20, 20, 10, 75)
        ON CONFLICT (id) DO NOTHING;
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        INSERT OR IGNORE INTO tahfiz_rubrik_config (id, bobot_kelancaran, bobot_ketepatan_ayat, bobot_tajwid, bobot_makharijul_huruf, bobot_kemandirian, min_lulus_score)
        VALUES ('default', 25, 25, 20, 20, 10, 75);
      `);
    }

    console.log('[TahfizDbInit] Tahfiz & Murojaah tables initialized successfully.');
  } catch (err: any) {
    console.error('[TahfizDbInit] Error initializing tahfiz tables:', err.message);
  }
}
