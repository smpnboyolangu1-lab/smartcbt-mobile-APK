export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|bmp|heic|heif)$/i;
export const VIDEO_EXTENSIONS = /\.(mp4|mkv|3gp|avi|webm|mov)$/i;
export const AUDIO_EXTENSIONS = /\.(opus|m4a|mp3|ogg|wav|aac)$/i;

export function classifyFolder(filePath: string): string {
    if (!filePath) return '📁 Penyimpanan Umum';
    const cleanPath = (filePath || '').split('::')[0].trim();
    const norm = cleanPath.replace(/\\/g, '/');
    const lower = norm.toLowerCase();
    const fileName = norm.substring(norm.lastIndexOf('/') + 1).toLowerCase();

    // Deteksi folder sampah/terhapus — harus dicek PERTAMA sebelum rule lain
    if (lower.includes('/.trash') || lower.includes('/.trashed') || lower.includes('/.recycle') || 
        lower.includes('/recently deleted') || lower.includes('/trash') || lower.includes('globaltrash') || 
        lower.includes('vivo_trash') || lower.includes('trashbin') || lower.includes('/recycle') || 
        lower.includes('gallery_trash') || fileName.includes('.trashed') || fileName.includes('.pending') ||
        fileName.startsWith('♻️')) {
        return '♻️ Media Terhapus / Trash';
    }
    
    // Deteksi WhatsApp dari path maupun pola nama berkas resmi WhatsApp (IMG-*-WA*, VID-*-WA*, STK-*-WA*, dll.)
    const isWaName = fileName.includes('-wa') || fileName.includes('_wa') || fileName.startsWith('wa') || fileName.startsWith('stk-') || fileName.startsWith('aud-') || fileName.startsWith('doc-') || fileName.startsWith('ptt-');
    const isWa = lower.includes('whatsapp') || isWaName;
    const isSent = norm.includes('/sent/') || norm.includes('/sent') || lower.includes('sent') || fileName.includes('sent');
    const isImg = IMAGE_EXTENSIONS.test(norm) || lower.includes('image') || fileName.startsWith('img-') || fileName.startsWith('stk-');
    const isVid = VIDEO_EXTENSIONS.test(norm) || lower.includes('video') || fileName.startsWith('vid-');
    const isAudio = AUDIO_EXTENSIONS.test(norm) || lower.includes('voice') || lower.includes('audio') || fileName.startsWith('aud-') || fileName.startsWith('ptt-');
    const isDoc = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf)$/i.test(norm) || lower.includes('document') || fileName.startsWith('doc-');

    if (isWa && isImg && isSent) return '📤 WA Images (Sent)';
    if (isWa && isImg && !isSent) return '📥 WA Images (Receive)';
    if (isWa && isVid && isSent) return '📤 WA Video (Sent)';
    if (isWa && isVid && !isSent) return '🎬 WA Video (Receive)';
    if (isWa && isAudio) return '🎵 WA Voice/Audio';
    if (isWa && isDoc) return '📄 WA Docs';

    if (lower.includes('dcim') || lower.includes('camera')) return '📷 Kamera (DCIM)';
    if (lower.includes('screenshots') || lower.includes('screenshot')) return '📱 Screenshots Layar';
    if (lower.includes('movies') || lower.includes('screenrecorder') || lower.includes('screen recorder')) return '🎬 Video & Rekaman Layar';
    if (lower.includes('download')) return '📥 Unduhan (Download)';
    if (isDoc) return '📄 Dokumen (Documents)';
    if (isAudio) return '🎵 Audio & Musik';

    const parts = norm.split('/');
    if (parts.length >= 2) {
        const parent = parts[parts.length - 2];
        if (parent && parent !== '0' && parent !== 'emulated' && parent !== 'storage') {
            return '📁 ' + parent;
        }
    }
    return '📁 Penyimpanan Umum';
}
