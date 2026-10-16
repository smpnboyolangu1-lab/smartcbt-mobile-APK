import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL || 'file:./dev.db';
const isPostgres = rawUrl.startsWith('postgres://') || rawUrl.startsWith('postgresql://');

let dbUrl = rawUrl;
if (!isPostgres) {
    dbUrl = rawUrl.includes('connection_limit') ? rawUrl : (rawUrl.includes('?') ? `${rawUrl}&connection_limit=1&busy_timeout=15000` : `${rawUrl}?connection_limit=1&busy_timeout=15000`);
} else {
    // For PostgreSQL, enable up to 25 connections in pool for instantaneous menu responsiveness
    if (!dbUrl.includes('connection_limit')) {
        dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connection_limit=25';
    }
}

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl
        }
    }
});

// Post-connection optimizations
(async () => {
    if (isPostgres) {
        console.log('⚡ Prisma connected to PostgreSQL (High-concurrency pool: 25 active).');
    } else {
        try {
            await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
            await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
            await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 15000;');
            await prisma.$queryRawUnsafe('PRAGMA temp_store = MEMORY;');
            await prisma.$queryRawUnsafe('PRAGMA cache_size = -64000;');
            console.log('⚡ SQLite WAL Mode & High Concurrency PRAGMAs successfully activated.');
        } catch (e) {
            console.warn('SQLite PRAGMA init note:', e);
        }
    }
})();

export default prisma;

