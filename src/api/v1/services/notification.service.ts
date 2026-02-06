import type { NotificationType, NotificationPriority } from "@prisma/client";
import prisma from "../../../infrastructure/db/prismaClient";

const DEDUPE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const P2_RATE_LIMIT_PER_MINUTE = 20;

export type CreateNotificationInput = {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  meta?: Record<string, unknown> | null;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  dedupeKey?: string | null;
  expiresAt?: Date | null;
  recipientScopeType?: "USER" | "ORG" | "BRANCH" | "ROLE" | null;
  recipientScopeId?: string | null;
};

/**
 * Single source for creating notifications. Applies dedupe, creates notification + IN_APP delivery row.
 * Realtime publish (Phase 3) and email/SMS (Phase 5) are wired later.
 */
export async function createNotification(input: CreateNotificationInput) {
  const {
    userId,
    type,
    title,
    message,
    meta = null,
    priority = "P2",
    actionUrl = null,
    dedupeKey = null,
    expiresAt = null,
    recipientScopeType = null,
    recipientScopeId = null,
  } = input;

  if (dedupeKey) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        dedupeKey,
        createdAt: { gte: since },
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { notification: existing, created: false };
  }

  if (priority === "P2") {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const recentCount = await prisma.notification.count({
      where: { userId, priority: "P2", createdAt: { gte: oneMinAgo } },
    });
    if (recentCount >= P2_RATE_LIMIT_PER_MINUTE) return { notification: null as any, created: false };
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      meta: (meta ?? undefined) as any,
      priority,
      status: "ACTIVE",
      actionUrl: actionUrl ?? undefined,
      dedupeKey: dedupeKey ?? undefined,
      expiresAt: expiresAt ?? undefined,
      recipientScopeType: recipientScopeType ?? undefined,
      recipientScopeId: recipientScopeId ?? undefined,
    },
  });

  await prisma.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      channel: "IN_APP",
      status: "SENT",
      attemptCount: 1,
    },
  });

  try {
    const { publishNotificationToUser } = require("../../../realtime/realtime.gateway");
    publishNotificationToUser(userId, { event: "notification:new", data: { notificationId: notification.id } });
  } catch (_) {
    // realtime optional
  }

  if (priority === "P0" || priority === "P1") {
    try {
      await enqueueEmailSmsIfAllowed(notification, userId);
    } catch (e) {
      console.warn("[NotificationService] enqueue email/sms failed", (e as Error)?.message);
    }
  }

  return { notification, created: true };
}

function inQuietHours(quietStart: number | null, quietEnd: number | null): boolean {
  if (quietStart == null || quietEnd == null) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (quietStart <= quietEnd) return mins >= quietStart && mins < quietEnd;
  return mins >= quietStart || mins < quietEnd;
}

async function enqueueEmailSmsIfAllowed(
  notification: { id: number; type: string; title: string; message: string; actionUrl: string | null; priority: string },
  userId: number
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      auth: { select: { email: true, phone: true } },
      notificationPrefs: true,
    },
  });
  if (!user?.auth) return;

  const prefs = user.notificationPrefs;
  const allowEmail = prefs?.allowEmail ?? true;
  const allowSms = prefs?.allowSms ?? false;
  const quietStart = prefs?.quietHoursStart ?? null;
  const quietEnd = prefs?.quietHoursEnd ?? null;
  const isP0 = notification.priority === "P0";
  const skipQuiet = isP0 || !inQuietHours(quietStart, quietEnd);

  const payload = {
    notificationId: notification.id,
    userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    actionUrl: notification.actionUrl ?? undefined,
    meta: null as Record<string, unknown> | null,
  };

  if (allowEmail && user.auth.email && skipQuiet) {
    const { enqueueEmailJob } = require("./notificationQueue");
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "EMAIL",
        toAddress: user.auth.email,
        status: "QUEUED",
        attemptCount: 0,
      },
    });
    await enqueueEmailJob({ ...payload, channel: "EMAIL", toAddress: user.auth.email });
  }

  if (allowSms && user.auth.phone && skipQuiet) {
    const { enqueueSmsJob } = require("./notificationQueue");
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "SMS",
        toAddress: user.auth.phone,
        status: "QUEUED",
        attemptCount: 0,
      },
    });
    await enqueueSmsJob({ ...payload, channel: "SMS", toAddress: user.auth.phone });
  }
}
