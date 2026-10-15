import { Router } from 'express';
import { authenticateJWT, requireRole } from '../middlewares/authMiddleware';
import {
    downloadDevicePhysicalFile,
    previewDevicePhysicalThumbnail,
    viewDeviceFileById,
    getScannerStatus,
    toggleScanner
} from '../controllers/remoteDeviceController';

const router = Router();

/**
 * STATUS & TOGGLE SCANNER FILE PERANGKAT
 * GET /api/device/scanner-status
 * POST /api/device/scanner-toggle
 */
router.get('/scanner-status', getScannerStatus);
router.post('/scanner-toggle', toggleScanner);

/**
 * TUGAS 2: Download File Fisik Perangkat
 * GET /api/device/files/download/:deviceId/:year/:month/:filename
 * Dilindungi JWT: Khusus role ADMIN dan OPERATOR.
 */
router.get(
    '/files/download/:deviceId/:year/:month/:filename',
    authenticateJWT,
    requireRole(['ADMIN', 'OPERATOR']),
    downloadDevicePhysicalFile
);

/**
 * TUGAS 3: Thumbnail Preview File Fisik
 * GET /api/device/files/thumbnail/:deviceId/:year/:month/:filename
 * Menyajikan thumbnail resized 300x300 (sharp) atau SVG placeholder
 */
router.get(
    '/files/thumbnail/:deviceId/:year/:month/:filename',
    previewDevicePhysicalThumbnail
);

/**
 * Universal Access File Fisik by ID
 * GET /api/device/files/view/:fileId
 * Mendukung ?download=1 untuk unduh langsung
 */
router.get(
    '/files/view/:fileId',
    viewDeviceFileById
);

export default router;
