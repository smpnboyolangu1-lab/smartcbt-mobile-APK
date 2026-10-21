const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function buildDeviceFileUrls(f, devId) {
    if (f && f.id) {
        return {
            thumbnailUrl: `/api/device/files/view/${encodeURIComponent(f.id)}`,
            downloadUrl: `/api/device/files/view/${encodeURIComponent(f.id)}?download=1`
        };
    }
    return { thumbnailUrl: '', downloadUrl: '' };
}

async function main() {
    const files = await prisma.deviceFile.findMany({
        where: { deviceId: '598f2e17-2727-4676-be4b-fbf600b9824d', NOT: { fileName: { startsWith: '.' } } },
        orderBy: { lastModified: 'desc' },
        take: 60
    });

    const selectedFileIds = new Set();
    const currentDeviceId = '598f2e17-2727-4676-be4b-fbf600b9824d';

    console.log('Testing renderVisualGallery mapping...');
    try {
        const html = files.map(f => {
            const isSelected = selectedFileIds.has(f.id);
            const norm = (f.filePath || '').replace(/\\/g, '/');
            const isVideo = /\.(mp4|mkv|avi|mov|webm|3gp)$/i.test(f.fileName || '') || f.category === 'VIDEO';
            const isAudio = /\.(mp3|wav|ogg|m4a|aac|opus)$/i.test(f.fileName || '') || f.category === 'AUDIO';
            const isImage = (f.category === 'PICTURES' || f.category === 'IMAGE' || /\.(jpg|jpeg|png|webp|bmp|heic|heif)$/i.test(f.fileName || ''));
            const ext = (f.fileExtension || '').toUpperCase();
            const icon = isVideo ? '🎬' : (isAudio ? '🎵' : (isImage ? '🖼️' : '📄'));

            const normLower = norm.toLowerCase();
            const nameLower = (f.fileName || '').toLowerCase();
            const isDeleted = f.category === 'DELETED_MEDIA' || f.isDeleted === true;
            let badge = '';

            const fileUrls = buildDeviceFileUrls(f, currentDeviceId);
            return `<div class="card">${f.fileName}</div>`;
        }).join('');
        console.log('Successfully generated HTML without errors, length:', html.length);
    } catch (e) {
        console.error('ERROR during renderVisualGallery:', e);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
