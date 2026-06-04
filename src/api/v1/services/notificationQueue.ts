/**
 * BullMQ queues for notification email/SMS.
 * Enqueue from NotificationService; process in notificationWorker.
 */
import { Queue } from "bullmq";
import { areRedisQueuesEnabled } from "../../../infrastructure/redis/redis.client";
import {
  getRedisConnectionOptions,
  isRedisEnabled,
} from "../../../infrastructure/redis/redisConnection";

const redisConfig = getRedisConnectionOptions();

let emailQueue: Queue | null = null;
let smsQueue: Queue | null = null;

function getEmailQueue(): Queue | null {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
  if (emailQueue) return emailQueue;
  try {
    emailQueue = new Queue("notif_email", { connection: redisConfig });
  } catch (e) {
    console.warn("[NotificationQueue] email queue init failed", (e as Error)?.message);
  }
  return emailQueue;
}

function getSmsQueue(): Queue | null {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
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

export async function enqueueEmailJob(payload: NotificationJobPayload): Promise<boolean> {
  const q = getEmailQueue();
  if (!q) return false;
  await q.add("send", payload, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  return true;
}

/**
 * Enqueue SMS job. Returns false when Redis/queue unavailable (caller should direct-send fallback).
 */
export async function enqueueSmsJob(payload: NotificationJobPayload): Promise<boolean> {
  const q = getSmsQueue();
  if (!q) return false;
  const attempts = Number(process.env.SMS_QUEUE_ATTEMPTS || 3);
  const delay = Number(process.env.SMS_QUEUE_BACKOFF_MS || 5000);
  await q.add("send", payload, {
    attempts,
    backoff: { type: "exponential", delay },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
  return true;
}

export async function getSmsQueueJobCounts(): Promise<{
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
} | null> {
  const q = getSmsQueue();
  if (!q) return null;
  const counts = await q.getJobCounts("waiting", "active", "failed", "delayed");
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
