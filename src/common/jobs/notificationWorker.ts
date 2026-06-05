/**
 * BullMQ worker for notification email/SMS.
 * Run: npm run worker:notifications
 * Requires REDIS_ENABLED and Redis to be running.
 */
import "dotenv/config";
import { Worker, Job } from "bullmq";
import prisma from "../../infrastructure/db/prismaClient";
import { renderNotificationEmail, renderNotificationSms } from "../../utils/notificationTemplates";
import { sendSmsViaGateway, logSmsFailure } from "../../integrations/sms/smsGateway.service";
import {
  processSmsQueueJob,
  SMS_LEGACY_QUEUE_NAME,
  SMS_QUEUE_NAME,
} from "../../shared/services/sms/sms.service";
import type { SmsJobPayload } from "../../shared/services/sms/sms.types";

import { areRedisQueuesEnabled } from "../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../infrastructure/redis/redisConnection";
import { recordSmsCostOnLog } from "../../api/v1/modules/campaign/smsCostMonitoring.service";

if (!isRedisEnabled() || !areRedisQueuesEnabled()) {
  console.log("[NotificationWorker] Redis disabled or unavailable; worker will not start.");
  process.exit(0);
}

const redisConfig = getRedisConnectionOptions();

type Payload = {
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

function resolveSmsBody(job: Job<Payload>): string {
  const { type, title, message, actionUrl, meta } = job.data;
  if (meta?.useRawMessage === true || meta?.campaignSmsLogId || String(type).startsWith("CAMPAIGN")) {
    return message;
  }
  return renderNotificationSms(type, { title, message, actionUrl });
}

function isFinalAttempt(job: Job<Payload>): boolean {
  const maxAttempts = job.opts.attempts ?? 3;
  return job.attemptsMade >= maxAttempts;
}

async function markCampaignSmsLog(
  logId: number,
  data: {
    status: "SENDING" | "SENT" | "FAILED";
    externalId?: string;
    errorMessage?: string;
    sent?: boolean;
  }
): Promise<void> {
  await prisma.campaignSmsLog.update({
    where: { id: logId },
    data: {
      status: data.status,
      externalId: data.externalId,
      errorMessage: data.errorMessage?.slice(0, 500),
      sentAt: data.sent ? new Date() : undefined,
    },
  });
}

async function processEmail(job: Job<Payload>) {
  const { toAddress, type, title, message, actionUrl } = job.data;
  const { sendMail } = require("../../utils/smtpMailer");
  const { subject, html, text } = renderNotificationEmail(type, { title, message, actionUrl });
  const result = await sendMail({ to: toAddress, subject, html, text });
  return result?.messageId || null;
}

async function processSms(job: Job<Payload>): Promise<string | null> {
  const { toAddress, type, meta } = job.data;
  const text = resolveSmsBody(job);
  const campaignSmsLogId =
    typeof meta?.campaignSmsLogId === "number" ? meta.campaignSmsLogId : undefined;

  if (campaignSmsLogId) {
    await markCampaignSmsLog(campaignSmsLogId, { status: "SENDING" });
  }

  try {
    const result = await sendSmsViaGateway(toAddress, text, {
      jobId: String(job.id),
      template: type,
      campaignSmsLogId,
    });

    if (campaignSmsLogId) {
      await markCampaignSmsLog(campaignSmsLogId, {
        status: "SENT",
        externalId: result.messageId,
        sent: true,
      });
      await recordSmsCostOnLog(campaignSmsLogId, {
        provider: result.provider,
        message: text,
      }).catch((err) =>
        console.warn("[NotificationWorker] SMS cost record failed:", (err as Error).message)
      );
    }

    return result.messageId || null;
  } catch (err) {
    const errorMessage = (err as Error)?.message || "Send failed";
    logSmsFailure({
      phone: toAddress,
      provider: "gateway",
      error: errorMessage,
      attempt: job.attemptsMade,
      jobId: String(job.id),
      template: type,
      campaignSmsLogId,
    });

    if (campaignSmsLogId && isFinalAttempt(job)) {
      await markCampaignSmsLog(campaignSmsLogId, {
        status: "FAILED",
        errorMessage,
      });
    }

    throw err;
  }
}

async function handleEmailJob(job: Job<Payload>) {
  const { notificationId, channel } = job.data;
  const delivery = await prisma.notificationDelivery.findFirst({
    where: { notificationId, channel: "EMAIL" },
  });
  if (!delivery) return;
  try {
    const providerMessageId = await processEmail(job);
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        providerMessageId: providerMessageId || undefined,
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: isFinalAttempt(job) ? "FAILED" : delivery.status,
        error: (err as Error)?.message?.slice(0, 500) || "Send failed",
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    throw err;
  }
}

async function handleSmsJob(job: Job<Payload>) {
  const { notificationId, channel } = job.data;
  const delivery =
    notificationId > 0
      ? await prisma.notificationDelivery.findFirst({
          where: { notificationId, channel: "SMS" },
        })
      : null;

  try {
    const providerMessageId = await processSms(job);

    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          providerMessageId: providerMessageId || undefined,
          attemptCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    }
  } catch (err) {
    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: isFinalAttempt(job) ? "FAILED" : delivery.status,
          error: (err as Error)?.message?.slice(0, 500) || "Send failed",
          attemptCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    }
    throw err;
  }
}

function run() {
  const emailWorker = new Worker<Payload>(
    "notif_email",
    async (job) => {
      await handleEmailJob(job);
    },
    { connection: redisConfig, concurrency: 2 }
  );
  const smsWorker = new Worker<Payload>(
    SMS_LEGACY_QUEUE_NAME,
    async (job) => {
      await handleSmsJob(job);
    },
    { connection: redisConfig, concurrency: Number(process.env.SMS_WORKER_CONCURRENCY || 5) }
  );
  const centralSmsWorker = new Worker<SmsJobPayload>(
    SMS_QUEUE_NAME,
    async (job) => {
      await processSmsQueueJob(job.data);
    },
    { connection: redisConfig, concurrency: Number(process.env.SMS_WORKER_CONCURRENCY || 5) }
  );

  emailWorker.on("error", (err) => console.warn("[NotificationWorker] Email worker error", (err as Error)?.message || err));
  emailWorker.on("completed", (job) => console.log("[NotificationWorker] Email job", job.id, "completed"));
  emailWorker.on("failed", (job, err) => console.warn("[NotificationWorker] Email job", job?.id, "failed", err?.message));
  smsWorker.on("error", (err) => console.warn("[NotificationWorker] SMS worker error", (err as Error)?.message || err));
  smsWorker.on("completed", (job) => console.log("[NotificationWorker] Legacy SMS job", job.id, "completed"));
  smsWorker.on("failed", (job, err) =>
    console.warn("[NotificationWorker] Legacy SMS job", job?.id, "failed", err?.message, `(attempt ${job?.attemptsMade})`)
  );
  centralSmsWorker.on("error", (err) =>
    console.warn("[NotificationWorker] Central SMS worker error", (err as Error)?.message || err)
  );
  centralSmsWorker.on("completed", (job) => console.log("[NotificationWorker] SMS job", job.id, "completed"));
  centralSmsWorker.on("failed", (job, err) =>
    console.warn("[NotificationWorker] SMS job", job?.id, "failed", err?.message, `(attempt ${job?.attemptsMade})`)
  );

  console.log("[NotificationWorker] Started notif_email, notif_sms (legacy), and smsQueue workers");
}

run();
