/**
 * Producer Governance: per-org feature flags (OrgFeatureFlag).
 * Enforce in producer flows (e.g. printing, batch create, code export).
 */

import type { PrismaClient } from "@prisma/client";

const DEFAULTS: Record<string, boolean> = {
  "producer.printing.enabled": true,
  "producer.batches.enabled": true,
  "producer.products.enabled": true,
  "producer.codes.export.enabled": true,
  "producer.staff.invites.enabled": true,
};

export async function getFlags(prisma: PrismaClient, producerOrgId: number): Promise<{ key: string; enabled: boolean }[]> {
  const rows = await prisma.orgFeatureFlag.findMany({
    where: { producerOrgId },
    select: { key: true, enabled: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
  const keys = Object.keys(DEFAULTS);
  return keys.map((key) => ({ key, enabled: byKey.get(key) ?? DEFAULTS[key] }));
}

export async function getFlag(prisma: PrismaClient, producerOrgId: number, key: string): Promise<boolean> {
  const row = await prisma.orgFeatureFlag.findUnique({
    where: { producerOrgId_key: { producerOrgId, key } },
    select: { enabled: true },
  });
  return row?.enabled ?? (DEFAULTS[key] ?? true);
}

/**
 * Throws if flag is disabled. Use in producer service layer before sensitive actions.
 */
export async function requireEnabled(prisma: PrismaClient, producerOrgId: number, key: string): Promise<void> {
  const enabled = await getFlag(prisma, producerOrgId, key);
  if (!enabled) {
    const err = new Error(`Feature is disabled for this producer organization: ${key}`) as Error & { code?: string; statusCode?: number };
    err.code = "FLAG_DISABLED";
    err.statusCode = 403;
    throw err;
  }
}

export async function setFlags(
  prisma: PrismaClient,
  producerOrgId: number,
  updates: { key: string; enabled: boolean }[],
  updatedByUserId?: number | null
): Promise<{ key: string; enabled: boolean; updatedAt: Date }[]> {
  const now = new Date();
  const result: { key: string; enabled: boolean; updatedAt: Date }[] = [];
  for (const { key, enabled } of updates) {
    const row = await prisma.orgFeatureFlag.upsert({
      where: { producerOrgId_key: { producerOrgId, key } },
      update: { enabled, updatedByUserId: updatedByUserId ?? undefined, updatedAt: now },
      create: {
        producerOrgId,
        key: key.slice(0, 128),
        enabled,
        updatedByUserId: updatedByUserId ?? undefined,
        updatedAt: now,
      },
    });
    result.push({ key: row.key, enabled: row.enabled, updatedAt: row.updatedAt });
  }
  return result;
}
