/**
 * SMS cost monitoring — estimates from message length and provider rates in env.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { estimateSmsCostBdt } from "../../../../integrations/sms/smsCost";
import type { CampaignSmsStatus } from "@prisma/client";

export type SmsCostSummary = {
  campaignId?: number;
  from: string;
  to: string;
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalSegments: number;
  estimatedCostBdt: number;
  byProvider: Record<string, { count: number; segments: number; costBdt: number }>;
  byTemplate: Record<string, { count: number; costBdt: number }>;
};

export function estimateMessageCost(message: string) {
  return estimateSmsCostBdt(message);
}

export async function recordSmsCostOnLog(
  logId: number,
  data: { provider: string; message: string }
): Promise<void> {
  const { segmentCount, estimatedCostBdt } = estimateSmsCostBdt(data.message);
  await prisma.campaignSmsLog.update({
    where: { id: logId },
    data: {
      provider: data.provider.slice(0, 32),
      segmentCount,
      estimatedCostBdt,
    },
  });
}

export async function getCampaignSmsCostSummary(input: {
  campaignId?: number;
  from?: Date;
  to?: Date;
}): Promise<SmsCostSummary> {
  const from = input.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = input.to ?? new Date();

  const logs = await prisma.campaignSmsLog.findMany({
    where: {
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      queuedAt: { gte: from, lte: to },
      status: { in: ["SENT", "DELIVERED", "FAILED", "SENDING"] as CampaignSmsStatus[] },
    },
    select: {
      status: true,
      provider: true,
      templateCode: true,
      message: true,
      segmentCount: true,
      estimatedCostBdt: true,
    },
  });

  const summary: SmsCostSummary = {
    campaignId: input.campaignId,
    from: from.toISOString(),
    to: to.toISOString(),
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    totalSegments: 0,
    estimatedCostBdt: 0,
    byProvider: {},
    byTemplate: {},
  };

  for (const log of logs) {
    const segments =
      log.segmentCount ?? estimateSmsCostBdt(log.message).segmentCount;
    const cost =
      log.estimatedCostBdt != null
        ? Number(log.estimatedCostBdt)
        : estimateSmsCostBdt(log.message).estimatedCostBdt;

    summary.totalSegments += segments;
    summary.estimatedCostBdt += cost;

    if (log.status === "DELIVERED") summary.totalDelivered++;
    else if (log.status === "FAILED") summary.totalFailed++;
    else if (log.status === "SENT" || log.status === "SENDING") summary.totalSent++;

    const prov = log.provider || "unknown";
    if (!summary.byProvider[prov]) {
      summary.byProvider[prov] = { count: 0, segments: 0, costBdt: 0 };
    }
    summary.byProvider[prov].count++;
    summary.byProvider[prov].segments += segments;
    summary.byProvider[prov].costBdt += cost;

    const tpl = log.templateCode || "unknown";
    if (!summary.byTemplate[tpl]) {
      summary.byTemplate[tpl] = { count: 0, costBdt: 0 };
    }
    summary.byTemplate[tpl].count++;
    summary.byTemplate[tpl].costBdt += cost;
  }

  summary.estimatedCostBdt = Math.round(summary.estimatedCostBdt * 10000) / 10000;
  return summary;
}
