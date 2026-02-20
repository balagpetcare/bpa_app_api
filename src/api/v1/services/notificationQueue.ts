/**
 * BullMQ queues for notification email/SMS.
 * Enqueue from NotificationService; process in notificationWorker.
 */
import { Queue } from "bullmq";
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

let emailQueue: Queue | null = null;
let smsQueue: Queue | null = null;

const REDIS_ENABLED = process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";

function getEmailQueue(): Queue | null {
  if (!REDIS_ENABLED) return null;
  if (emailQueue) return emailQueue;
  try {
    emailQueue = new Queue("notif_email", { connection: redisConfig });
  } catch (e) {
    console.warn("[NotificationQueue] email queue init failed", (e as Error)?.message);
  }
  return emailQueue;
}

function getSmsQueue(): Queue | null {
  if (!REDIS_ENABLED) return null;
  if (smsQueue) return smsQueue;
  try {
    smsQueue = new Queue("notif_sms", { connection: redisConfig });
  } catch (e) {
    console.warn("[NotificationQueue] sms queue init failed", (e as Error)?.message);
  }
  return smsQueue;
}

export type NotificationJobPayload = {
  notificationId: number;
  userId: number;
  channel: "EMAIL" | "SMS";
  toAddress: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  meta?: Record<string, unknown> | null;
};

export async function enqueueEmailJob(payload: NotificationJobPayload): Promise<void> {
  const q = getEmailQueue();
  if (!q) return;
  await q.add("send", payload, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
}

export async function enqueueSmsJob(payload: NotificationJobPayload): Promise<void> {
  const q = getSmsQueue();
  if (!q) return;
  await q.add("send", payload, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
}
