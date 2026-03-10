/**
 * Doctor notification adapter over global Notification center.
 * Keeps doctor panel endpoints scoped and stable without duplicating models.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

async function listForDoctor(
  userId: number,
  opts?: { limit?: number; offset?: number }
) {
  const limit = Math.min(Math.max(Number(opts?.limit ?? 20), 1), 100);
  const offset = Math.max(Number(opts?.offset ?? 0), 0);
  const where = {
    userId,
    status: "ACTIVE",
  };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        meta: true,
        priority: true,
        actionUrl: true,
        readAt: true,
        createdAt: true,
        severity: true,
        source: true,
        orgId: true,
        branchId: true,
      },
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

async function unreadCountForDoctor(userId: number) {
  const count = await prisma.notification.count({
    where: {
      userId,
      status: "ACTIVE",
      readAt: null,
    },
  });
  return { count };
}

async function markReadForDoctor(userId: number, notificationId: number) {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, userId: true, readAt: true },
  });
  if (!existing) return null;
  if (!existing.readAt) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    await prisma.notificationRead.upsert({
      where: {
        notificationId_userId: { notificationId, userId },
      },
      create: { notificationId, userId },
      update: {},
    });
  }

  try {
    const { emitUnreadCount } = require("../../../../realtime/socketio.gateway");
    const unread = await prisma.notification.count({
      where: { userId, status: "ACTIVE", readAt: null },
    });
    if (typeof emitUnreadCount === "function") emitUnreadCount(userId, unread);
  } catch (_) {}

  return { id: notificationId, read: true };
}

async function createDoctorSystemNotification(
  userId: number,
  payload: {
    title: string;
    message: string;
    actionUrl?: string | null;
    branchId?: number | null;
    orgId?: number | null;
    meta?: Record<string, unknown> | null;
  }
) {
  const notificationService = require("../../services/notification.service");
  const result = await notificationService.createNotification({
    userId,
    type: "SYSTEM",
    title: payload.title,
    message: payload.message,
    actionUrl: payload.actionUrl ?? null,
    branchId: payload.branchId ?? null,
    orgId: payload.orgId ?? null,
    meta: payload.meta ?? null,
    source: "doctor_panel",
    severity: "info",
    dedupeKey: null,
  });

  try {
    const created = result?.notification;
    if (created) {
      const { emitDoctorNotification } = require("../../../../realtime/socketio.gateway");
      if (typeof emitDoctorNotification === "function") {
        emitDoctorNotification(userId, {
          id: created.id,
          title: created.title,
          message: created.message,
          type: created.type,
          createdAt: created.createdAt,
          readAt: created.readAt,
        });
      }
    }
  } catch (_) {}

  return result;
}

module.exports = {
  listForDoctor,
  unreadCountForDoctor,
  markReadForDoctor,
  createDoctorSystemNotification,
};
