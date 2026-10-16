import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Endpoint senyap (silent ingestion) untuk menerima log error/crash dari APK Android
 * POST /api/app/client-logs
 */
export async function recordClientLog(req: Request, res: Response) {
  try {
    const {
      level = "ERROR",
      tag = "General",
      errorMessage = "Unknown Error",
      stackTrace = null,
      deviceModel = null,
      androidVersion = null,
      appVersion = null,
      networkType = null,
      serverUrl = null,
      activityName = null,
      userId = null,
      username = null,
      role = null
    } = req.body;

    // Sanitasi input agar aman dari XSS dan tidak meluap
    const stripHtml = (s: any, maxLen: number) => String(s || '').replace(/<[^>]*>/g, '').trim().substring(0, maxLen);
    const safeErrorMessage = stripHtml(errorMessage || "Unknown Error", 2000);
    const safeStackTrace = stackTrace ? String(stackTrace).replace(/<[^>]*>/g, '').substring(0, 15000) : null;
    const safeLevel = ["CRASH", "FATAL", "ERROR", "WARN", "INFO"].includes(String(level).toUpperCase())
      ? String(level).toUpperCase()
      : "ERROR";

    // Simpan ke database
    const createdLog = await prisma.appClientErrorLog.create({
      data: {
        level: safeLevel,
        tag: tag ? stripHtml(tag, 100) : null,
        errorMessage: safeErrorMessage,
        stackTrace: safeStackTrace,
        deviceModel: deviceModel ? stripHtml(deviceModel, 150) : null,
        androidVersion: androidVersion ? stripHtml(androidVersion, 100) : null,
        appVersion: appVersion ? stripHtml(appVersion, 50) : null,
        networkType: networkType ? stripHtml(networkType, 50) : null,
        serverUrl: serverUrl ? stripHtml(serverUrl, 200) : null,
        activityName: activityName ? stripHtml(activityName, 150) : null,
        userId: userId ? stripHtml(userId, 100) : null,
        username: username ? stripHtml(username, 100) : null,
        role: role ? stripHtml(role, 50) : null,
        resolved: false
      }
    });

    // Sinkronkan juga ke ActivityEventLog terpusat dengan source = 'APK'
    try {
      const { logApkEvent } = await import("../middleware/activityLogger");
      const mappedModule = req.body?.module && ['ATTENDANCE', 'CBT', 'HOMEWORK', 'EKANTIN', 'AUTH', 'EXTRACURRICULAR'].includes(req.body.module)
        ? req.body.module
        : (tag?.toUpperCase().includes('CBT') ? 'CBT' : (tag?.toUpperCase().includes('ATTEND') ? 'ATTENDANCE' : (tag?.toUpperCase().includes('HOMEWORK') ? 'HOMEWORK' : 'APP_CLIENT')));

      logApkEvent({
        module: mappedModule as any,
        action: req.body?.action || (tag ? `APK_${tag.toUpperCase()}` : 'CLIENT_EVENT'),
        outcome: safeLevel === 'INFO' ? 'SUCCESS' : (safeLevel === 'WARN' ? 'REJECTED' : 'ERROR'),
        httpStatus: 200,
        message: safeErrorMessage,
        userId: userId || null,
        username: username || null,
        name: req.body?.name || null,
        className: req.body?.className || null,
        role: role || null,
        deviceId: deviceModel || null,
        appVersion: appVersion || null,
        durationMs: 0,
        payload: JSON.stringify({
          tag,
          activityName,
          networkType,
          serverUrl,
          payload: req.body?.payload || null
        }),
        anomalyFlag: ['CRASH', 'FATAL'].includes(safeLevel)
      });
    } catch (e: any) {
      console.warn("Could not sync client log to activity log:", e.message);
    }

    console.log(`[CLIENT-LOG] [${safeLevel}] From: ${username || "Anon"} (${deviceModel || "Unknown Device"}): ${safeErrorMessage.substring(0, 80)}`);

    return res.status(200).json({
      success: true,
      logId: createdLog.id
    });
  } catch (err: any) {
    console.error("[CLIENT-LOG] Gagal menyimpan log klien:", err?.message || err);
    // Tetap kembalikan 200 OK agar APK tidak menganggap sebagai crash jaringan
    return res.status(200).json({
      success: false,
      message: "Log dicatat secara lokal"
    });
  }
}

/**
 * Mendapatkan daftar log error klien untuk Portal Admin
 * GET /api/app/client-logs
 */
export async function getClientLogs(req: Request, res: Response) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit as string) || 30));
    const skip = (page - 1) * limit;

    const level = req.query.level ? String(req.query.level).toUpperCase() : undefined;
    const role = req.query.role ? String(req.query.role).toUpperCase() : undefined;
    const resolvedQuery = req.query.resolved;
    const search = req.query.search ? String(req.query.search).trim() : undefined;

    const where: any = {};

    if (level && level !== "ALL") {
      if (level === "CRASH") {
        where.level = { in: ["CRASH", "FATAL"] };
      } else {
        where.level = level;
      }
    }

    if (role && role !== "ALL") {
      where.role = { contains: role };
    }

    if (resolvedQuery !== undefined && resolvedQuery !== "ALL") {
      where.resolved = resolvedQuery === "true" || resolvedQuery === "1";
    }

    if (search) {
      where.OR = [
        { errorMessage: { contains: search } },
        { deviceModel: { contains: search } },
        { username: { contains: search } },
        { tag: { contains: search } },
        { activityName: { contains: search } }
      ];
    }

    const [logs, total, unresolvedCount, crashCount] = await Promise.all([
      prisma.appClientErrorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.appClientErrorLog.count({ where }),
      prisma.appClientErrorLog.count({ where: { resolved: false } }),
      prisma.appClientErrorLog.count({ where: { level: { in: ["CRASH", "FATAL"] } } })
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats: {
        total,
        unresolvedCount,
        crashCount
      }
    });
  } catch (err: any) {
    console.error("[CLIENT-LOG] Error fetching client logs:", err);
    return res.status(500).json({ success: false, message: "Gagal mengambil log error" });
  }
}

/**
 * Tandai log error sebagai selesai (Resolved)
 * PUT /api/app/client-logs/:id/resolve
 */
export async function resolveClientLog(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const { resolved = true, note = "Ditangani oleh Admin" } = req.body;

    const updated = await prisma.appClientErrorLog.update({
      where: { id },
      data: {
        resolved: Boolean(resolved),
        resolvedAt: resolved ? new Date() : null,
        resolutionNote: note
      }
    });

    return res.json({
      success: true,
      message: resolved ? "Log berhasil ditandai selesai" : "Log dikembalikan ke status belum selesai",
      data: updated
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Gagal memperbarui status log" });
  }
}

/**
 * Hapus log error tertentu
 * DELETE /api/app/client-logs/:id
 */
export async function deleteClientLog(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    await prisma.appClientErrorLog.delete({ where: { id } });
    return res.json({ success: true, message: "Log berhasil dihapus" });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Gagal menghapus log" });
  }
}

/**
 * Hapus massal (Bulk cleanup log)
 * POST /api/app/client-logs/cleanup
 */
export async function cleanupClientLogs(req: Request, res: Response) {
  try {
    const { type = "resolved", days = 30 } = req.body;
    let deletedCount = 0;

    if (type === "resolved") {
      const resDel = await prisma.appClientErrorLog.deleteMany({
        where: { resolved: true }
      });
      deletedCount = resDel.count;
    } else if (type === "all") {
      const resDel = await prisma.appClientErrorLog.deleteMany({});
      deletedCount = resDel.count;
    } else {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const resDel = await prisma.appClientErrorLog.deleteMany({
        where: { createdAt: { lt: cutoff } }
      });
      deletedCount = resDel.count;
    }

    return res.json({
      success: true,
      message: `Berhasil membersihkan ${deletedCount} log error`,
      count: deletedCount
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Gagal membersihkan log" });
  }
}
