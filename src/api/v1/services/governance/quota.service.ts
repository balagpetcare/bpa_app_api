/**
 * Producer Governance: per-org quotas (OrgQuota). Event-driven increment from service layer.
 * Resets used by period (DAILY = start of day UTC, MONTHLY = start of month UTC).
 */

import type { PrismaClient } from "@prisma/client";
import type { OrgQuotaResetPeriod } from "@prisma/client";

const QUOTA_KEYS = [
  "producer.products.submit.daily",
  "producer.batches.create.daily",
  "producer.print.daily",
  "producer.uploads.daily",
];

const DEFAULT_LIMITS: Record<string, number> = {
  "producer.products.submit.daily": 100,
  "producer.batches.create.daily": 50,
  "producer.print.daily": 2000,
  "producer.uploads.daily": 100,
};

function startOfDayUTC(d: Date): Date {
  const t = new Date(d);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

function startOfMonthUTC(d: Date): Date {
  const t = new Date(d);
  t.setUTCDate(1);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

function periodStart(resetPeriod: OrgQuotaResetPeriod): Date {
  const now = new Date();
  return resetPeriod === "MONTHLY" ? startOfMonthUTC(now) : startOfDayUTC(now);
}

export async function getQuotas(
  prisma: PrismaClient,
  producerOrgId: number
): Promise<{ key: string; limit: number; used: number; resetPeriod: string }[]> {
  const rows = await prisma.orgQuota.findMany({
    where: { producerOrgId },
    select: { key: true, limit: true, used: true, resetPeriod: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return QUOTA_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      limit: row?.limit ?? 0,
      used: row?.used ?? 0,
      resetPeriod: row?.resetPeriod ?? "DAILY",
    };
  });
}

/**
 * Check limit for current period and increment used. Throws if would exceed limit.
 * Resets used to 0 if we're in a new period (by updatedAt).
 */
export async function checkAndIncrement(
  prisma: PrismaClient,
  producerOrgId: number,
  key: string,
  amount: number
): Promise<void> {
  if (amount <= 0) return;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const row = await tx.orgQuota.findUnique({
      where: { producerOrgId_key: { producerOrgId, key } },
    });
    const limit = row?.limit ?? DEFAULT_LIMITS[key] ?? 0;
    const resetPeriod = (row?.resetPeriod ?? "DAILY") as OrgQuotaResetPeriod;
    const periodStartDate = periodStart(resetPeriod);
    const effectiveUsed = !row || row.updatedAt < periodStartDate ? 0 : row.used;
    if (effectiveUsed + amount > limit) {
      const err = new Error(
        `Quota exceeded for ${key}: used ${effectiveUsed + amount} exceeds limit ${limit}`
      ) as Error & { code?: string; statusCode?: number };
      err.code = "QUOTA_EXCEEDED";
      err.statusCode = 403;
      throw err;
    }
    const defaultLimit = DEFAULT_LIMITS[key] ?? 0;
    await tx.orgQuota.upsert({
      where: { producerOrgId_key: { producerOrgId, key } },
      update: { used: effectiveUsed + amount, updatedAt: now },
      create: {
        producerOrgId,
        key: key.slice(0, 128),
        limit: defaultLimit,
        used: amount,
        resetPeriod: "DAILY",
        updatedAt: now,
      },
    });
  });
}

export async function setQuotas(
  prisma: PrismaClient,
  producerOrgId: number,
  updates: { key: string; limit: number; resetPeriod?: OrgQuotaResetPeriod }[],
  updatedByUserId?: number | null
): Promise<{ key: string; limit: number; used: number; resetPeriod: string }[]> {
  const result: { key: string; limit: number; used: number; resetPeriod: string }[] = [];
  for (const { key, limit, resetPeriod } of updates) {
    const row = await prisma.orgQuota.upsert({
      where: { producerOrgId_key: { producerOrgId, key } },
      update: { limit, resetPeriod: resetPeriod ?? undefined, updatedByUserId: updatedByUserId ?? undefined },
      create: {
        producerOrgId,
        key: key.slice(0, 128),
        limit,
        used: 0,
        resetPeriod: resetPeriod ?? "DAILY",
        updatedByUserId: updatedByUserId ?? undefined,
      },
    });
    result.push({
      key: row.key,
      limit: row.limit,
      used: row.used,
      resetPeriod: row.resetPeriod,
    });
  }
  return result;
}
