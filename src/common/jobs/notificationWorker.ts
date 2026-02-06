/**
 * BullMQ worker for notification email/SMS.
 * Run: npx ts-node -r ts-node/register src/common/jobs/notificationWorker.ts
 * Requires REDIS_ENABLED and Redis to be running.
 */
import "dotenv/config";
import { Worker, Job } from "bullmq";
import prisma from "../../infrastructure/db/prismaClient";
import { renderNotificationEmail, renderNotificationSms } from "../../utils/notificationTemplates";

const REDIS_ENABLED = process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";
if (!REDIS_ENABLED) {
  console.log("[NotificationWorker] REDIS_ENABLED=false; worker will not start (queues disabled).");
  process.exit(0);
}

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

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

async function processEmail(job: Job<Payload>) {
  const { toAddress, type, title, message, actionUrl } = job.data;
  const { sendMail } = require("../../utils/smtpMailer");
  const { subject, html, text } = renderNotificationEmail(type, { title, message, actionUrl });
  const result = await sendMail({ to: toAddress, subject, html, text });
  return result?.messageId || null;
}

async function processSms(job: Job<Payload>) {
  const { toAddress, type, title, message, actionUrl } = job.data;
  const text = renderNotificationSms(type, { title, message, actionUrl });
  console.log("[NotificationWorker] SMS would send to", toAddress, ":", text.slice(0, 80) + "...");
  return null;
}

async function handleEmailJob(job: Job<Payload>) {
  const { notificationId, channel, toAddress } = job.data;
  const delivery = await prisma.notificationDelivery.findFirst({
    where: { notificationId, channel: "EMAIL" },
  });
  if (!delivery) return;
  try {
    const providerMessageId = await processEmail(job);
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENT", providerMessageId: providerMessageId || undefined, attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
  } catch (err) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: (err as Error)?.message?.slice(0, 500) || "Send failed", attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
    throw err;
  }
}

async function handleSmsJob(job: Job<Payload>) {
  const { notificationId, channel } = job.data;
  const delivery = await prisma.notificationDelivery.findFirst({
    where: { notificationId, channel: "SMS" },
  });
  if (!delivery) return;
  try {
    await processSms(job);
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENT", attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
  } catch (err) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: (err as Error)?.message?.slice(0, 500) || "Send failed", attemptCount: { increment: 1 }, updatedAt: new Date() },
    });
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
    "notif_sms",
    async (job) => {
      await handleSmsJob(job);
    },
    { connection: redisConfig, concurrency: 2 }
  );

  emailWorker.on("error", (err) => console.warn("[NotificationWorker] Email worker error", (err as Error)?.message || err));
  emailWorker.on("completed", (job) => console.log("[NotificationWorker] Email job", job.id, "completed"));
  emailWorker.on("failed", (job, err) => console.warn("[NotificationWorker] Email job", job?.id, "failed", err?.message));
  smsWorker.on("error", (err) => console.warn("[NotificationWorker] SMS worker error", (err as Error)?.message || err));
  smsWorker.on("completed", (job) => console.log("[NotificationWorker] SMS job", job.id, "completed"));
  smsWorker.on("failed", (job, err) => console.warn("[NotificationWorker] SMS job", job?.id, "failed", err?.message));

  console.log("[NotificationWorker] Started notif_email and notif_sms workers");
}

run();
