import type { Request, Response, NextFunction } from "express";
import { NotificationStatus, NotificationType } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

/** Producer notification display priority (API layer, non-breaking). */
const PRODUCER_DISPLAY_PRIORITY: Record<string, "HIGH" | "MEDIUM" | "LOW"> = {
  VERIFICATION_CASE_REJECTED: "HIGH",
  BATCH_SUSPICIOUS_ACTIVITY: "HIGH",
  ENFORCEMENT_CODE_BLOCKED: "HIGH",
  ENFORCEMENT_BATCH_QUARANTINED: "HIGH",
  ENFORCEMENT_PRODUCT_DEACTIVATED: "HIGH",
  ENFORCEMENT_ORG_SUSPENDED: "HIGH",
  ENFORCEMENT_ACTION_REVERTED: "MEDIUM",
  PRODUCT_REJECTED: "HIGH",
  STAFF_INVITE_ACCEPTED: "MEDIUM",
  VERIFICATION_CASE_APPROVED: "MEDIUM",
  PRODUCT_APPROVED: "MEDIUM",
  SYSTEM_INFO: "LOW",
  SYSTEM: "LOW",
};
const ACTION_REQUIRED_TYPES: NotificationType[] = [
  NotificationType.VERIFICATION_CASE_REJECTED,
  NotificationType.BATCH_SUSPICIOUS_ACTIVITY,
  NotificationType.PRODUCT_REJECTED,
  NotificationType.ENFORCEMENT_CODE_BLOCKED,
  NotificationType.ENFORCEMENT_BATCH_QUARANTINED,
  NotificationType.ENFORCEMENT_PRODUCT_DEACTIVATED,
  NotificationType.ENFORCEMENT_ORG_SUSPENDED,
];

const producerPanelOr = [
  { actionUrl: { startsWith: "/producer" } },
  { source: "producer" },
  { source: "enforcement" },
  { type: NotificationType.STAFF_INVITE },
  { type: NotificationType.BATCH_SUSPICIOUS_ACTIVITY },
  { type: NotificationType.PRODUCT_APPROVED },
  { type: NotificationType.PRODUCT_REJECTED },
  { type: NotificationType.ENFORCEMENT_CODE_BLOCKED },
  { type: NotificationType.ENFORCEMENT_BATCH_QUARANTINED },
  { type: NotificationType.ENFORCEMENT_PRODUCT_DEACTIVATED },
  { type: NotificationType.ENFORCEMENT_ORG_SUSPENDED },
  { type: NotificationType.ENFORCEMENT_ACTION_REVERTED },
];

function getProducerDisplayPriority(type: string): "HIGH" | "MEDIUM" | "LOW" {
  return PRODUCER_DISPLAY_PRIORITY[type] ?? "LOW";
}

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
 * GET /api/v1/notifications?scope=dropdown|page&limit=20&cursor=&type=&branchId=&priority=&from=&to=&unread=
 * List notifications for current user with cursor pagination.
 * scope=dropdown: limit 20, quick load. scope=page: full paged list.
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const scope = (req.query.scope as string) || "dropdown";
    const limit = scope === "page"
      ? Math.min(Math.max(1, Number(req.query.limit) || 50), 100)
      : Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const cursor = req.query.cursor as string | undefined;
    const cursorId = cursor ? parseInt(cursor, 10) : undefined;
    const unreadOnly = String(req.query.unread || "").toLowerCase() === "1" || req.query.unread === "true";
    const typeFilter = req.query.type as string | undefined;
    const branchIdFilter = req.query.branchId ? Number(req.query.branchId) : undefined;
    const priorityFilter = req.query.priority as string | undefined;
    const fromDate = req.query.from ? new Date(req.query.from as string) : undefined;
    const toDate = req.query.to ? new Date(req.query.to as string) : undefined;
    const panel = (req.query.panel as string) || undefined;
    const filterActionRequired = String(req.query.filter || "").toLowerCase() === "actionrequired" || req.query.filter === "action_required";

    const where: any = { userId, status: NotificationStatus.ACTIVE };
    if (panel === "producer") {
      where.AND = [{ OR: producerPanelOr }];
      if (filterActionRequired) {
        where.AND.push({ type: { in: ACTION_REQUIRED_TYPES } });
      }
    }
    if (unreadOnly) where.readAt = null;
    if (cursorId && Number.isFinite(cursorId)) where.id = { lt: cursorId };
    if (typeFilter) where.type = typeFilter as NotificationType;
    if (branchIdFilter && Number.isFinite(branchIdFilter)) where.branchId = branchIdFilter;
    if (priorityFilter) where.priority = priorityFilter;
    if ((fromDate && !isNaN(fromDate.getTime())) || (toDate && !isNaN(toDate.getTime()))) {
      where.createdAt = {};
      if (fromDate && !isNaN(fromDate.getTime())) (where.createdAt as any).gte = fromDate;
      if (toDate && !isNaN(toDate.getTime())) (where.createdAt as any).lte = toDate;
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
        severity: true,
        source: true,
        orgId: true,
        branchId: true,
        senderId: true,
        sender: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });

    const hasMore = notifications.length > limit;
    const rawItems = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore && rawItems.length ? String(rawItems[rawItems.length - 1].id) : null;

    const items =
      panel === "producer"
        ? rawItems.map((n) => ({
            ...n,
            displayPriority: getProducerDisplayPriority(String(n.type)),
          }))
        : rawItems;

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

    const panel = (req.query.panel as string) || undefined;
    const filterActionRequired = String(req.query.filter || "").toLowerCase() === "actionrequired" || req.query.filter === "action_required";
    const where: any = { userId, readAt: null, status: NotificationStatus.ACTIVE };
    if (panel === "producer") {
      where.AND = [{ OR: producerPanelOr }];
      if (filterActionRequired) where.AND.push({ type: { in: ACTION_REQUIRED_TYPES } });
    }

    const count = await prisma.notification.count({
      where,
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
    try {
      const { emitUnreadCount } = require("../../../../realtime/socketio.gateway");
      const count = await prisma.notification.count({ where: { userId, readAt: null, status: NotificationStatus.ACTIVE } });
      emitUnreadCount(userId, count);
    } catch (_) {}
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/notifications/count
 * Alias for unread-count. Returns { count: number }.
 */
export async function count(req: Request, res: Response, next: NextFunction) {
  return unreadCount(req, res, next);
}

/**
 * POST /api/v1/notifications/mark-read
 * Body: { ids: number[] } - mark specific notifications as read.
 */
export async function markReadBulk(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : [];
    if (ids.length === 0) return res.json({ success: true, data: { updated: 0 } });

    const updated = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId },
      data: { readAt: new Date() },
    });
    try {
      const { emitUnreadCount } = require("../../../../realtime/socketio.gateway");
      const count = await prisma.notification.count({ where: { userId, readAt: null, status: NotificationStatus.ACTIVE } });
      emitUnreadCount(userId, count);
    } catch (_) {}
    return res.json({ success: true, data: { updated: updated.count } });
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
    try {
      const { emitUnreadCount } = require("../../../../realtime/socketio.gateway");
      emitUnreadCount(userId, 0);
    } catch (_) {}
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
    const soundEnabled = body.soundEnabled !== undefined ? Boolean(body.soundEnabled) : undefined;
    const quietHoursStart = body.quietHoursStart !== undefined ? (Number(body.quietHoursStart) || null) : undefined;
    const quietHoursEnd = body.quietHoursEnd !== undefined ? (Number(body.quietHoursEnd) || null) : undefined;
    const enabledTypes = body.enabledTypes !== undefined ? body.enabledTypes : undefined;

    const prefs = await prisma.userNotificationPrefs.upsert({
      where: { userId },
      create: {
        userId,
        allowEmail: allowEmail ?? true,
        allowSms: allowSms ?? false,
        soundEnabled: soundEnabled ?? true,
        quietHoursStart: quietHoursStart ?? null,
        quietHoursEnd: quietHoursEnd ?? null,
        enabledTypes: enabledTypes ?? undefined,
      },
      update: {
        ...(allowEmail !== undefined && { allowEmail }),
        ...(allowSms !== undefined && { allowSms }),
        ...(soundEnabled !== undefined && { soundEnabled }),
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

/**
 * GET /api/v1/notifications/analytics?range=7d|30d|custom&from=&to=
 * Returns counts by type, priority, and unread trend.
 */
export async function analytics(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const range = (req.query.range as string) || "7d";
    let from: Date;
    const to = new Date();
    if (range === "30d") {
      from = new Date();
      from.setDate(from.getDate() - 30);
    } else if (range === "custom" && req.query.from) {
      from = new Date(req.query.from as string);
      if (isNaN(from.getTime())) from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else {
      from = new Date();
      from.setDate(from.getDate() - 7);
    }

    const panel = (req.query.panel as string) || undefined;
    const baseWhere: any = { userId, status: NotificationStatus.ACTIVE, createdAt: { gte: from, lte: to } };
    if (panel === "producer") {
      baseWhere.AND = [{ OR: producerPanelOr }];
    }
    const unreadWhere: any = { userId, readAt: null, status: NotificationStatus.ACTIVE };
    if (panel === "producer") {
      unreadWhere.AND = [{ OR: producerPanelOr }];
    }

    const [byType, byPriority, unreadCount] = await Promise.all([
      prisma.notification.groupBy({
        by: ["type"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.notification.groupBy({
        by: ["priority"],
        where: baseWhere,
        _count: { id: true },
      }),
      prisma.notification.count({
        where: unreadWhere,
      }),
    ]);

    return res.json({
      success: true,
      data: {
        range: { from: from.toISOString(), to: to.toISOString() },
        byType: byType.map((x) => ({ type: x.type, count: x._count.id })),
        byPriority: byPriority.map((x) => ({ priority: x.priority, count: x._count.id })),
        unreadCount,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/notifications/test (dev only)
 * Creates a test notification for the current user.
 */
export async function testCreate(req: Request, res: Response, next: NextFunction) {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ success: false, message: "Test endpoint disabled in production" });
    }
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { createNotification } = require("../../services/notification.service");
    const body = req.body || {};
    const { notification } = await createNotification({
      userId,
      type: body.type || "SYSTEM",
      title: body.title || "Test notification",
      message: body.message || "This is a test notification from the API.",
      priority: body.priority || "P2",
      actionUrl: body.actionUrl || null,
      source: "test",
      severity: "info",
    });
    return res.json({ success: true, data: { notification } });
  } catch (err) {
    return next(err);
  }
}
