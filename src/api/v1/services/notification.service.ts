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
  /** Global Notification Center: org/branch scope */
  orgId?: number | null;
  branchId?: number | null;
  severity?: "info" | "warn" | "error" | "success" | null;
  source?: string | null; // module: auth|clinic|order|producer|wallet|branch_access|etc.
  senderId?: number | null;
  panel?: string | null; // e.g. "staff" for dispatch notifications
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
    orgId = null,
    branchId = null,
    severity = null,
    source = null,
    senderId = null,
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
      orgId: orgId ?? undefined,
      branchId: branchId ?? undefined,
      severity: severity ?? undefined,
      source: source ?? undefined,
      senderId: senderId ?? undefined,
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
  try {
    const { emitNotificationNew } = require("../../../realtime/socketio.gateway");
    emitNotificationNew(userId, {
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        actionUrl: notification.actionUrl,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        severity: notification.severity,
        source: notification.source,
        orgId: notification.orgId,
        branchId: notification.branchId,
      },
    });
  } catch (_) {
    // socket.io optional
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

/** Payload for notifyUser / notifyRole / notifyMany */
export type NotificationPayload = Omit<CreateNotificationInput, "userId"> & {
  type: NotificationType;
  title: string;
  message: string;
};

/**
 * Notify a single user. Wrapper around createNotification.
 * @see createNotification
 */
export async function notifyUser(
  userId: number,
  payload: NotificationPayload
): Promise<{ notification: any; created: boolean }> {
  return createNotification({ ...payload, userId });
}

/**
 * Notify users with a given role in org/branch (Owner or BRANCH_MANAGER).
 * Resolves userIds from BranchMember/Organization and creates one notification per user.
 */
export async function notifyRole(
  orgId: number,
  branchId: number | null,
  role: "OWNER" | "BRANCH_MANAGER",
  payload: NotificationPayload
): Promise<Array<{ userId: number; created: boolean }>> {
  const userIds: number[] = [];
  if (role === "OWNER") {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { ownerUserId: true },
    });
    if (org?.ownerUserId) userIds.push(org.ownerUserId);
  } else if (role === "BRANCH_MANAGER" && branchId) {
    const members = await prisma.branchMember.findMany({
      where: { branchId, role: "BRANCH_MANAGER", status: "ACTIVE" },
      select: { userId: true },
    });
    userIds.push(...members.map((m) => m.userId));
  }
  const results: Array<{ userId: number; created: boolean }> = [];
  for (const uid of userIds) {
    const res = await createNotification({
      ...payload,
      userId: uid,
      orgId: payload.orgId ?? orgId,
      branchId: payload.branchId ?? branchId,
    }).catch(() => ({ notification: null, created: false }));
    results.push({ userId: uid, created: (res as any).created ?? false });
  }
  return results;
}

/**
 * Notify multiple users. Creates one notification per userId.
 */
export async function notifyMany(
  userIds: number[],
  payload: NotificationPayload
): Promise<Array<{ userId: number; created: boolean }>> {
  const results: Array<{ userId: number; created: boolean }> = [];
  for (const uid of [...new Set(userIds)]) {
    const res = await createNotification({ ...payload, userId: uid }).catch(() => ({
      notification: null,
      created: false,
    }));
    results.push({ userId: uid, created: (res as any).created ?? false });
  }
  return results;
}
