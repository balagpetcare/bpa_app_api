/**
 * Notification retention: soft-clean read notifications older than N days.
 * Sets status = EXPIRED so they no longer appear in list/unread count.
 * Producer-only first (configurable).
 * Env: NOTIFICATIONS_RETENTION_DAYS_READ (default 90), NOTIFICATION_RETENTION_PRODUCER_ONLY (default true)
 */
import { NotificationStatus, NotificationType } from "@prisma/client";
import prisma from "../../infrastructure/db/prismaClient";

const RETENTION_DAYS = Number(process.env.NOTIFICATIONS_RETENTION_DAYS_READ || process.env.NOTIFICATION_RETENTION_DAYS || 90);
const PRODUCER_ONLY = process.env.NOTIFICATION_RETENTION_PRODUCER_ONLY !== "false" && process.env.NOTIFICATION_RETENTION_PRODUCER_ONLY !== "0";

const producerPanelWhere = {
  OR: [
    { actionUrl: { startsWith: "/producer" } },
    { source: "producer" },
    { type: NotificationType.STAFF_INVITE },
    { type: NotificationType.BATCH_SUSPICIOUS_ACTIVITY },
  ],
};

export async function runNotificationRetentionJob(): Promise<{ expired: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const baseWhere = {
    status: NotificationStatus.ACTIVE,
    readAt: { not: null, lt: cutoff },
  };

  const where = PRODUCER_ONLY ? { ...baseWhere, AND: [producerPanelWhere] } : baseWhere;

  const result = await prisma.notification.updateMany({
    where,
    data: { status: NotificationStatus.EXPIRED },
  });

  const expired = result.count ?? 0;
  if (expired > 0) {
    console.log(`[NOTIFICATION_RETENTION] marked ${expired} read notifications (older than ${RETENTION_DAYS} days${PRODUCER_ONLY ? ", producer-only" : ""}) as EXPIRED`);
  }
  return { expired };
}
