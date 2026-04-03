import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

const DEFAULT_SLOS: Array<{
  sloKey: string;
  domain: "INVENTORY" | "SUPPORT";
  targetKind: "PERCENT_WITHIN_WINDOW" | "COUNT_BREACH";
  targetValue: number;
  windowDays: number;
  metaJson: Record<string, unknown>;
}> = [
  {
    sloKey: "FULFILL_DISPATCH_ON_TIME",
    domain: "INVENTORY",
    targetKind: "PERCENT_WITHIN_WINDOW",
    targetValue: 90,
    windowDays: 7,
    metaJson: { maxHoursToShip: 48, description: "% dispatches with in-transit within maxHoursToShip of createdAt" },
  },
  {
    sloKey: "DISPATCH_DISCREPANCY_BREACH",
    domain: "INVENTORY",
    targetKind: "COUNT_BREACH",
    targetValue: 0,
    windowDays: 7,
    metaJson: { description: "Count of unresolved dispatch discrepancies" },
  },
];

export async function ensureDefaultSlos(orgId: number) {
  for (const s of DEFAULT_SLOS) {
    await prisma.serviceLevelObjective.upsert({
      where: { orgId_sloKey: { orgId, sloKey: s.sloKey } },
      create: {
        orgId,
        sloKey: s.sloKey,
        domain: s.domain,
        targetKind: s.targetKind,
        targetValue: new Prisma.Decimal(s.targetValue),
        windowDays: s.windowDays,
        metaJson: s.metaJson as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

export type SloWindow = { periodStart: Date; periodEnd: Date };

/**
 * Measures dispatch timeliness and open discrepancy counts; writes SloMeasurement rows.
 */
export async function evaluateSlosForOrg(orgId: number, window: SloWindow) {
  await ensureDefaultSlos(orgId);

  const sloDispatch = await prisma.serviceLevelObjective.findUnique({
    where: { orgId_sloKey: { orgId, sloKey: "FULFILL_DISPATCH_ON_TIME" } },
  });
  const sloDisc = await prisma.serviceLevelObjective.findUnique({
    where: { orgId_sloKey: { orgId, sloKey: "DISPATCH_DISCREPANCY_BREACH" } },
  });

  const dispatches = await prisma.stockDispatch.findMany({
    where: {
      orgId,
      createdAt: { gte: window.periodStart, lte: window.periodEnd },
      inTransitAt: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      inTransitAt: true,
    },
  });

  const maxHours =
    Number((sloDispatch?.metaJson as { maxHoursToShip?: number })?.maxHoursToShip) || 48;
  const maxMs = maxHours * 3600 * 1000;

  let onTime = 0;
  for (const d of dispatches) {
    if (!d.inTransitAt) continue;
    const dt = d.inTransitAt.getTime() - d.createdAt.getTime();
    if (dt <= maxMs) onTime++;
  }
  const sampleCount = dispatches.length;
  /** No dispatches in window → do not imply 100% on-time (misleading). */
  const measuredPct = sampleCount > 0 ? (onTime / sampleCount) * 100 : null;

  const openDiscWindowed = await prisma.stockDispatchDiscrepancy.count({
    where: {
      orgId,
      status: "PENDING",
      createdAt: { gte: window.periodStart, lte: window.periodEnd },
    },
  });

  const openDiscAllPending = await prisma.stockDispatchDiscrepancy.count({
    where: { orgId, status: "PENDING" },
  });

  const measurements: { sloId: number; measuredValue: Prisma.Decimal; breachCount: number; sampleCount: number; trace: object }[] = [];

  if (sloDispatch) {
    measurements.push({
      sloId: sloDispatch.id,
      measuredValue: measuredPct != null ? new Prisma.Decimal(measuredPct) : null,
      breachCount: sampleCount - onTime,
      sampleCount,
      trace: {
        maxHoursToShip: maxHours,
        onTimeCount: onTime,
        noDispatchesInWindow: sampleCount === 0,
        dispatchIdsSample: dispatches.slice(0, 20).map((d) => d.id),
      },
    });
  }

  if (sloDisc) {
    measurements.push({
      sloId: sloDisc.id,
      measuredValue: new Prisma.Decimal(openDiscWindowed),
      breachCount: openDiscAllPending,
      sampleCount: openDiscAllPending,
      trace: {
        openDiscrepanciesWindowed: openDiscWindowed,
        openDiscrepanciesAllPending: openDiscAllPending,
        note: "breachCount uses all PENDING org-wide; measuredValue is window-created PENDING count",
      },
    });
  }

  await prisma.sloMeasurement.deleteMany({
    where: {
      orgId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
    },
  });

  for (const m of measurements) {
    await prisma.sloMeasurement.create({
      data: {
        orgId,
        sloId: m.sloId,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        measuredValue: m.measuredValue,
        breachCount: m.breachCount,
        sampleCount: m.sampleCount,
        calculationTrace: m.trace as object,
      },
    });
  }

  return {
    measurementsWritten: measurements.length,
    dispatchSample: sampleCount,
    openDiscrepanciesWindowed: openDiscWindowed,
    openDiscrepanciesAllPending: openDiscAllPending,
  };
}

export async function listSloDefinitions(orgId: number) {
  await ensureDefaultSlos(orgId);
  return prisma.serviceLevelObjective.findMany({
    where: { orgId },
    orderBy: { sloKey: "asc" },
  });
}

export async function listSloMeasurements(orgId: number, window: SloWindow, sloKey?: string) {
  const where: Prisma.SloMeasurementWhereInput = {
    orgId,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
  };
  if (sloKey) {
    where.slo = { sloKey };
  }
  return prisma.sloMeasurement.findMany({
    where,
    include: { slo: true },
    orderBy: { id: "desc" },
  });
}

export async function updateSloDefinition(
  orgId: number,
  id: number,
  patch: { targetValue?: number; isActive?: boolean; windowDays?: number; metaJson?: object }
) {
  const existing = await prisma.serviceLevelObjective.findFirst({
    where: { id, orgId },
  });
  if (!existing) return null;
  return prisma.serviceLevelObjective.update({
    where: { id },
    data: {
      ...(patch.targetValue != null ? { targetValue: new Prisma.Decimal(patch.targetValue) } : {}),
      ...(patch.isActive != null ? { isActive: patch.isActive } : {}),
      ...(patch.windowDays != null ? { windowDays: patch.windowDays } : {}),
      ...(patch.metaJson != null ? { metaJson: patch.metaJson } : {}),
    },
  });
}
