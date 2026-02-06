import type { Request, Response, NextFunction } from "express";
import prisma from "../../../../infrastructure/db/prismaClient";

function getAuthUserId(req: any): number | null {
  const id =
    req?.user?.id ??
    req?.userId ??
    req?.auth?.userId ??
    req?.authUser?.id ??
    req?.session?.user?.id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /api/v1/notifications?limit=20&cursor=
 * List notifications for current user with cursor pagination.
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const cursor = req.query.cursor as string | undefined;
    const cursorId = cursor ? parseInt(cursor, 10) : undefined;
    const unreadOnly = String(req.query.unread || "").toLowerCase() === "1" || req.query.unread === "true";

    const where: any = { userId };
    if (unreadOnly) where.readAt = null;
    if (cursorId && Number.isFinite(cursorId)) {
      where.id = { lt: cursorId };
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        meta: true,
        priority: true,
        status: true,
        actionUrl: true,
        readAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const hasMore = notifications.length > limit;
    const items = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore && items.length ? String(items[items.length - 1].id) : null;

    return res.json({
      success: true,
      data: { items, nextCursor, hasMore },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/notifications/unread-count
 */
export async function unreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const count = await prisma.notification.count({
      where: { userId, readAt: null, status: "ACTIVE" },
    });

    return res.json({ success: true, data: { count } });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/notifications/:id/read
 */
export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const existing = await prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Notification not found" });

    await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    // Optionally record in notification_reads for multi-device read tracking
    await prisma.notificationRead.upsert({
      where: {
        notificationId_userId: { notificationId: id, userId },
      },
      create: { notificationId: id, userId },
      update: {},
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/notifications/read-all
 */
export async function readAll(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const updated = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return res.json({ success: true, data: { updated: updated.count } });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/notifications/settings
 */
export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const prefs = await prisma.userNotificationPrefs.findUnique({
      where: { userId },
    });

    const data = prefs ?? {
      allowEmail: true,
      allowSms: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      enabledTypes: null,
    };

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/v1/notifications/settings
 * Body: { allowEmail?, allowSms?, quietHoursStart?, quietHoursEnd?, enabledTypes? }
 */
export async function putSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const body = req.body || {};
    const allowEmail = body.allowEmail !== undefined ? Boolean(body.allowEmail) : undefined;
    const allowSms = body.allowSms !== undefined ? Boolean(body.allowSms) : undefined;
    const quietHoursStart = body.quietHoursStart !== undefined ? (Number(body.quietHoursStart) || null) : undefined;
    const quietHoursEnd = body.quietHoursEnd !== undefined ? (Number(body.quietHoursEnd) || null) : undefined;
    const enabledTypes = body.enabledTypes !== undefined ? body.enabledTypes : undefined;

    const prefs = await prisma.userNotificationPrefs.upsert({
      where: { userId },
      create: {
        userId,
        allowEmail: allowEmail ?? true,
        allowSms: allowSms ?? false,
        quietHoursStart: quietHoursStart ?? null,
        quietHoursEnd: quietHoursEnd ?? null,
        enabledTypes: enabledTypes ?? undefined,
      },
      update: {
        ...(allowEmail !== undefined && { allowEmail }),
        ...(allowSms !== undefined && { allowSms }),
        ...(quietHoursStart !== undefined && { quietHoursStart }),
        ...(quietHoursEnd !== undefined && { quietHoursEnd }),
        ...(enabledTypes !== undefined && { enabledTypes }),
      },
    });

    return res.json({ success: true, data: prefs });
  } catch (err) {
    return next(err);
  }
}
