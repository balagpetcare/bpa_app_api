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
import {
  SMS_QUEUE_NAME,
  SMS_LEGACY_QUEUE_NAME,
  getSmsQueueAttempts,
  getSmsQueueBackoffMs,
} from "../../../shared/services/sms/sms.constants";
import type { SmsJobPayload } from "../../../shared/services/sms/sms.types";

const redisConfig = getRedisConnectionOptions();

let emailQueue: Queue | null = null;
let smsQueue: Queue<SmsJobPayload> | null = null;
let legacySmsQueue: Queue<NotificationJobPayload> | null = null;

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

function getSmsQueue(): Queue<SmsJobPayload> | null {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
  if (smsQueue) return smsQueue;
  try {
    smsQueue = new Queue(SMS_QUEUE_NAME, {
      connection: redisConfig,
      defaultJobOptions: {
        attempts: getSmsQueueAttempts(),
        backoff: { type: "exponential", delay: getSmsQueueBackoffMs() },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  } catch (e) {
    console.warn("[NotificationQueue] sms queue init failed", (e as Error)?.message);
  }
  return smsQueue;
}

function getLegacySmsQueue(): Queue<NotificationJobPayload> | null {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) return null;
  if (legacySmsQueue) return legacySmsQueue;
  try {
    legacySmsQueue = new Queue<NotificationJobPayload>(SMS_LEGACY_QUEUE_NAME, {
      connection: redisConfig,
    });
  } catch (e) {
    console.warn("[NotificationQueue] legacy sms queue init failed", (e as Error)?.message);
  }
  return legacySmsQueue;
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
  const q = getLegacySmsQueue();
  if (!q) return false;
  const attempts = getSmsQueueAttempts();
  const delay = getSmsQueueBackoffMs();
  await q.add("send", payload, {
    attempts,
    backoff: { type: "exponential", delay },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
  return true;
}

/** Enqueue a central SMS module job (sms_logs + smsQueue). */
export async function enqueueCentralSmsJob(payload: SmsJobPayload): Promise<boolean> {
  const q = getSmsQueue();
  if (!q) return false;
  await q.add("send", payload);
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
  const legacy = getLegacySmsQueue();
  const legacyCounts = legacy
    ? await legacy.getJobCounts("waiting", "active", "failed", "delayed")
    : null;
  return {
    waiting: (counts.waiting ?? 0) + (legacyCounts?.waiting ?? 0),
    active: (counts.active ?? 0) + (legacyCounts?.active ?? 0),
    failed: (counts.failed ?? 0) + (legacyCounts?.failed ?? 0),
    delayed: (counts.delayed ?? 0) + (legacyCounts?.delayed ?? 0),
  };
}
