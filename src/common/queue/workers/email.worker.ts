/**
 * BullMQ worker for producer staff invite emails.
 * Run with app when REDIS_URL (or Redis) is present. Do not log raw invite tokens.
 */
import "dotenv/config";
import { Worker, Job } from "bullmq";
import prisma from "../../../infrastructure/db/prismaClient";
import { sendInviteEmail } from "../../email/email.service";
import type { ProducerStaffInviteEmailJobPayload } from "../queues";
import { QUEUE_NAME } from "../queues";

import { areRedisQueuesEnabled } from "../../../infrastructure/redis/redis.client";
import { getRedisConnectionOptions, isRedisEnabled } from "../../../infrastructure/redis/redisConnection";

function getConnection() {
  return getRedisConnectionOptions();
}

async function processJob(job: Job<ProducerStaffInviteEmailJobPayload>): Promise<string | null> {
  const { deliveryId, to, inviteLink, producerName, roleLabel, expiresAt, ownerName, customMessage } = job.data;
  const result = await sendInviteEmail({
    to,
    inviteLink,
    producerName,
    roleLabel,
    expiresAt: new Date(expiresAt),
    ownerName,
    customMessage,
  });
  if ("skipped" in result) {
    const isSmtpMissing =
      result.reason?.toLowerCase().includes("smtp") ||
      result.reason === "SMTP not configured";
    await prisma.producerStaffInviteDelivery.update({
      where: { id: deliveryId },
      data: {
        status: isSmtpMissing ? "FAILED" : "SKIPPED",
        lastError: isSmtpMissing ? "SMTP not configured" : result.reason,
        attemptCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    return null;
  }
  return result.messageId || null;
}

function run(): void {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) {
    console.log("Email worker: Redis not configured or unavailable; worker will not start.");
    return;
  }
  const worker = new Worker<ProducerStaffInviteEmailJobPayload>(
    QUEUE_NAME,
    async (job) => {
      const { deliveryId, inviteId, to } = job.data;
      try {
        const messageId = await processJob(job);
        if (messageId !== undefined && messageId !== null) {
          await prisma.producerStaffInviteDelivery.update({
            where: { id: deliveryId },
            data: {
              status: "SENT",
              provider: "smtp",
              messageId,
              sentAt: new Date(),
              attemptCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });
        }
      } catch (err) {
        const msg = (err as Error)?.message?.slice(0, 500) || "Send failed";
        await prisma.producerStaffInviteDelivery.update({
          where: { id: deliveryId },
          data: {
            status: "FAILED",
            lastError: msg,
            attemptCount: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        throw err;
      }
    },
    { connection: getConnection(), concurrency: 2 }
  );

  worker.on("error", (err) =>
    console.warn("Email worker: connection error", (err as Error)?.message)
  );
  worker.on("completed", (job) =>
    console.log(
      "Email worker: job completed deliveryId=%s inviteId=%s to=%s",
      job.data.deliveryId,
      job.data.inviteId,
      job.data.to
    )
  );
  worker.on("failed", (job, err) =>
    console.warn(
      "Email worker: job failed deliveryId=%s inviteId=%s error=%s",
      job?.data?.deliveryId,
      job?.data?.inviteId,
      (err as Error)?.message
    )
  );
  console.log("Email worker started");
}

export function startProducerStaffInviteEmailWorker(): void {
  run();
}

// When run as main process (e.g. npm run worker:email), start the worker
if (typeof require !== "undefined" && require.main === module) {
  startProducerStaffInviteEmailWorker();
}
