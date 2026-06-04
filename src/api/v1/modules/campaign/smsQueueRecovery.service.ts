/**
 * Recover campaign SMS stuck in QUEUED/SENDING when worker was down or Redis blipped.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { areRedisQueuesEnabled } from "../../../../infrastructure/redis/redis.client";
import { isRedisEnabled } from "../../../../infrastructure/redis/redisConnection";
import { getSmsQueueJobCounts } from "../../services/notificationQueue";
import { enqueueCampaignSmsMessage } from "./campaign.smsQueue";

const DEFAULT_STUCK_MINUTES = 15;

export function getStuckSmsThresholdMinutes(): number {
  const n = Number(process.env.SMS_STUCK_RECOVERY_MINUTES || DEFAULT_STUCK_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STUCK_MINUTES;
}

export async function recoverStuckCampaignSmsLogs(input?: {
  campaignId?: number;
  olderThanMinutes?: number;
  limit?: number;
}): Promise<{ recovered: number; failed: number; skipped: number }> {
  if (!isRedisEnabled() || !areRedisQueuesEnabled()) {
    throw new Error("Redis is not enabled or unavailable — cannot recover SMS queue jobs");
  }

  const minutes = input?.olderThanMinutes ?? getStuckSmsThresholdMinutes();
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const limit = input?.limit ?? 100;

  const stuck = await prisma.campaignSmsLog.findMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      queuedAt: { lt: cutoff },
      ...(input?.campaignId ? { campaignId: input.campaignId } : {}),
    },
    orderBy: { queuedAt: "asc" },
    take: limit,
  });

  let recovered = 0;
  let failed = 0;
  let skipped = 0;

  for (const log of stuck) {
    try {
      const enqueued = await enqueueCampaignSmsMessage(log.phone, log.message, {
        template: log.templateCode || "CAMPAIGN_SMS",
        campaignSmsLogId: log.id,
        bookingId: log.bookingId ?? undefined,
      });
      if (!enqueued) {
        skipped++;
        continue;
      }
      await prisma.campaignSmsLog.update({
        where: { id: log.id },
        data: { status: "QUEUED", errorMessage: null },
      });
      recovered++;
    } catch (err) {
      await prisma.campaignSmsLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          errorMessage: ((err as Error).message || "Recovery enqueue failed").slice(0, 500),
        },
      });
      failed++;
    }
  }

  return { recovered, failed, skipped };
}

export async function getSmsInfrastructureHealth(): Promise<{
  redisEnabled: boolean;
  queue: { waiting: number; active: number; failed: number; delayed: number } | null;
  providers: { sslWireless: boolean; bulkSmsBd: boolean; smsEnabled: boolean };
  stuckLogsEstimate: number;
}> {
  const { sslWirelessProvider } = require("../../../../integrations/sms/sslWireless.provider");
  const { bulkSmsBdProvider } = require("../../../../integrations/sms/bulkSmsBd.provider");
  const { isSmsEnabled } = require("../../../../integrations/sms/smsGateway.service");

  const cutoff = new Date(Date.now() - getStuckSmsThresholdMinutes() * 60 * 1000);
  const stuckLogsEstimate = await prisma.campaignSmsLog.count({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      queuedAt: { lt: cutoff },
    },
  });

  let queue: Awaited<ReturnType<typeof getSmsQueueJobCounts>> = null;
  if (isRedisEnabled()) {
    try {
      queue = await Promise.race([
        getSmsQueueJobCounts(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
    } catch {
      queue = null;
    }
  }

  return {
    redisEnabled: isRedisEnabled(),
    queue,
    providers: {
      sslWireless: sslWirelessProvider.isConfigured(),
      bulkSmsBd: bulkSmsBdProvider.isConfigured(),
      smsEnabled: isSmsEnabled(),
    },
    stuckLogsEstimate,
  };
}
