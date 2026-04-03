import type { AiPlanningScope, Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_WINDOW_DAYS,
  DEMAND_LEDGER_TYPES,
  MIN_WEEKS_FOR_DEMAND_VARIANCE,
} from "./aiConstants";
import type { ExplainFactor } from "./aiExplainability";
import { clamp, linearRegressionSlope } from "./aiExplainability";

const METHOD_BASELINE = "SIMPLE_LEDGER_BASELINE";

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getBranchLocationIds(branchId: number): Promise<number[]> {
  const locs = await prisma.inventoryLocation.findMany({
    where: { branchId, isActive: true },
    select: { id: true },
  });
  return locs.map((l) => l.id);
}

export async function getWarehouseLocationIds(branchId: number, warehouseId: number): Promise<number[]> {
  const locs = await prisma.inventoryLocation.findMany({
    where: { branchId, warehouseId, isActive: true },
    select: { id: true },
  });
  return locs.map((l) => l.id);
}

export async function listDistinctWarehouseIdsForBranch(branchId: number): Promise<number[]> {
  const rows = await prisma.inventoryLocation.findMany({
    where: { branchId, warehouseId: { not: null }, isActive: true },
    select: { warehouseId: true },
    distinct: ["warehouseId"],
  });
  return rows.map((r) => r.warehouseId).filter((w): w is number => w != null);
}

export type ForecastComputeResult = {
  variantId: number;
  forecastUnits: number;
  avgDailyDemand: number;
  confidence: number;
  factors: ExplainFactor[];
  inputs: Record<string, unknown>;
};

/**
 * Aggregate consumption from ledger (absolute outbound) per variant for given locations.
 */
export async function aggregateConsumptionByVariant(
  locationIds: number[],
  windowDays: number
): Promise<{
  byVariant: Map<number, number>;
  ledgerRowCount: number;
  windowStart: Date;
  windowEnd: Date;
}> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 86400000);
  if (!locationIds.length) {
    return { byVariant: new Map(), ledgerRowCount: 0, windowStart, windowEnd };
  }

  const rows = await prisma.stockLedger.findMany({
    where: {
      locationId: { in: locationIds },
      createdAt: { gte: windowStart, lte: windowEnd },
      type: { in: [...DEMAND_LEDGER_TYPES] },
      quantityDelta: { lt: 0 },
    },
    select: { variantId: true, quantityDelta: true },
  });

  const byVariant = new Map<number, number>();
  for (const r of rows) {
    const u = Math.abs(Number(r.quantityDelta));
    byVariant.set(r.variantId, (byVariant.get(r.variantId) ?? 0) + u);
  }
  return { byVariant, ledgerRowCount: rows.length, windowStart, windowEnd };
}

/**
 * Weekly demand totals for a variant (for variance / trend), same window as aggregateConsumptionByVariant.
 */
export async function weeklyTotalsForVariant(
  locationIds: number[],
  variantId: number,
  windowStart: Date,
  windowEnd: Date
): Promise<Map<number, number>> {
  if (!locationIds.length) return new Map();
  const weekRows = await prisma.stockLedger.findMany({
    where: {
      locationId: { in: locationIds },
      variantId,
      createdAt: { gte: windowStart, lte: windowEnd },
      type: { in: [...DEMAND_LEDGER_TYPES] },
      quantityDelta: { lt: 0 },
    },
    select: { createdAt: true, quantityDelta: true },
  });
  const W = 7 * 86400000;
  const byWeek = new Map<number, number>();
  for (const r of weekRows) {
    const wi = Math.floor((r.createdAt.getTime() - windowStart.getTime()) / W);
    byWeek.set(wi, (byWeek.get(wi) ?? 0) + Math.abs(Number(r.quantityDelta)));
  }
  return byWeek;
}

export async function computeForecastForVariant(
  orgId: number,
  branchId: number,
  variantId: number,
  horizonDays: number,
  windowDays: number,
  scope?: {
    planningScope?: AiPlanningScope;
    scopeWarehouseId?: number;
    locationIds?: number[];
  }
): Promise<ForecastComputeResult | null> {
  const planningScope = scope?.planningScope ?? "BRANCH";
  const scopeWarehouseId = scope?.scopeWarehouseId ?? 0;
  let locationIds = scope?.locationIds;
  if (!locationIds) {
    if (planningScope === "WAREHOUSE" && scopeWarehouseId > 0) {
      locationIds = await getWarehouseLocationIds(branchId, scopeWarehouseId);
    } else {
      locationIds = await getBranchLocationIds(branchId);
    }
  }
  const { byVariant, ledgerRowCount, windowStart, windowEnd } = await aggregateConsumptionByVariant(
    locationIds,
    windowDays
  );
  const totalUnits = byVariant.get(variantId);
  if (totalUnits == null || totalUnits <= 0) return null;

  const spanDays = Math.max(1, (windowEnd.getTime() - windowStart.getTime()) / 86400000);
  const avgDaily = totalUnits / spanDays;

  const byWeek = await weeklyTotalsForVariant(locationIds, variantId, windowStart, windowEnd);
  const weekIndices = [...byWeek.keys()].sort((a, b) => a - b);

  let trendAdj = 0;
  if (weekIndices.length >= 3) {
    const ys = weekIndices.map((wi) => byWeek.get(wi) ?? 0);
    const xs = weekIndices.map((_, i) => i);
    const slope = linearRegressionSlope(xs, ys);
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    if (meanY > 1e-6) trendAdj = clamp(slope / meanY, -0.15, 0.15);
  }

  const forecastUnits = Math.max(0, avgDaily * horizonDays * (1 + trendAdj));

  const weeklyTotals = [...byWeek.values()];
  let cv = 0;
  if (weeklyTotals.length >= 2) {
    const m = weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length;
    const v = weeklyTotals.reduce((s, x) => s + (x - m) * (x - m), 0) / weeklyTotals.length;
    cv = m > 1e-6 ? Math.sqrt(v) / m : 0;
  }
  const confidence = clamp(
    0.25 + 0.35 * Math.min(1, ledgerRowCount / 200) + 0.3 * (1 - clamp(cv, 0, 1)),
    0.1,
    0.95
  );

  const factors: ExplainFactor[] = [
    { name: "avgDailyDemand", value: avgDaily, description: "Mean units/day from ledger over the window" },
    { name: "horizonDays", value: horizonDays, description: "Forecast horizon" },
    { name: "trendAdjustment", value: trendAdj, description: "Capped linear trend from weekly buckets" },
    { name: "totalConsumptionUnits", value: totalUnits, description: "Sum of outbound consumption in window" },
    { name: "planningScope", value: planningScope, description: "BRANCH = all branch locations; WAREHOUSE = one warehouse" },
    { name: "scopeWarehouseId", value: scopeWarehouseId, description: "Warehouse id when scope is WAREHOUSE" },
  ];

  return {
    variantId,
    forecastUnits,
    avgDailyDemand: avgDaily,
    confidence,
    factors,
    inputs: {
      orgId,
      branchId,
      windowDays,
      ledgerRowCount,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      planningScope,
      scopeWarehouseId,
      locationCount: locationIds.length,
    },
  };
}

export async function upsertForecastSnapshot(
  orgId: number,
  branchId: number,
  variantId: number,
  horizonDays: number,
  windowDays: number,
  computed: ForecastComputeResult,
  planningScope: AiPlanningScope,
  scopeWarehouseId: number
): Promise<void> {
  const inputsJson = { ...computed.inputs, method: METHOD_BASELINE } as Prisma.InputJsonValue;
  const factorsJson = computed.factors as unknown as Prisma.InputJsonValue;
  await prisma.aiForecastSnapshot.upsert({
    where: {
      orgId_branchId_variantId_horizonDays_planningScope_scopeWarehouseId: {
        orgId,
        branchId,
        variantId,
        horizonDays,
        planningScope,
        scopeWarehouseId,
      },
    },
    create: {
      orgId,
      branchId,
      variantId,
      horizonDays,
      windowDays,
      forecastUnits: computed.forecastUnits,
      avgDailyDemand: computed.avgDailyDemand,
      method: METHOD_BASELINE,
      confidence: computed.confidence,
      inputsJson,
      factorsJson,
      planningScope,
      scopeWarehouseId,
    },
    update: {
      windowDays,
      forecastUnits: computed.forecastUnits,
      avgDailyDemand: computed.avgDailyDemand,
      method: METHOD_BASELINE,
      confidence: computed.confidence,
      inputsJson,
      factorsJson,
      computedAt: new Date(),
    },
  });
}

async function runForecastForScope(
  orgId: number,
  branchId: number,
  options: { horizonDays?: number; windowDays?: number; maxVariants?: number },
  planningScope: AiPlanningScope,
  scopeWarehouseId: number
): Promise<{ processed: number; skipped: number }> {
  const horizonDays = options?.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const windowDays = options?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxVariants = options?.maxVariants ?? 500;

  let locationIds: number[];
  if (planningScope === "WAREHOUSE" && scopeWarehouseId > 0) {
    locationIds = await getWarehouseLocationIds(branchId, scopeWarehouseId);
  } else {
    locationIds = await getBranchLocationIds(branchId);
  }
  const { byVariant } = await aggregateConsumptionByVariant(locationIds, windowDays);
  const variantIds = [...byVariant.keys()].slice(0, maxVariants);
  let processed = 0;
  let skipped = 0;
  const scopeArg = { planningScope, scopeWarehouseId, locationIds };
  for (const variantId of variantIds) {
    const fc = await computeForecastForVariant(orgId, branchId, variantId, horizonDays, windowDays, scopeArg);
    if (!fc) {
      skipped++;
      continue;
    }
    await upsertForecastSnapshot(orgId, branchId, variantId, horizonDays, windowDays, fc, planningScope, scopeWarehouseId);
    processed++;
  }
  return { processed, skipped };
}

export async function runForecastForBranch(
  orgId: number,
  branchId: number,
  options?: { horizonDays?: number; windowDays?: number; maxVariants?: number }
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;
  const r0 = await runForecastForScope(orgId, branchId, options, "BRANCH", 0);
  processed += r0.processed;
  skipped += r0.skipped;

  const whIds = await listDistinctWarehouseIdsForBranch(branchId);
  for (const wid of whIds) {
    const rw = await runForecastForScope(orgId, branchId, options, "WAREHOUSE", wid);
    processed += rw.processed;
    skipped += rw.skipped;
  }
  return { processed, skipped };
}

export type ListForecastParams = {
  orgId: number;
  branchId: number;
  horizonDays?: number;
  variantId?: number;
  productId?: number;
  categoryId?: number;
  /** When set, return WAREHOUSE-scoped snapshots for this warehouse id. */
  warehouseId?: number;
  /** BRANCH (default) or WAREHOUSE — must align with warehouseId. */
  planningScope?: AiPlanningScope;
  take?: number;
};

export async function listForecastSnapshots(params: ListForecastParams): Promise<
  Array<{
    snapshot: Record<string, unknown>;
    explain: { method: string; factors: ExplainFactor[]; inputs: Record<string, unknown> };
  }>
> {
  const horizonDays = params.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const planningScope = params.planningScope ?? (params.warehouseId ? "WAREHOUSE" : "BRANCH");
  const scopeWarehouseId = params.warehouseId ?? 0;

  const rows = await prisma.aiForecastSnapshot.findMany({
    where: {
      orgId: params.orgId,
      branchId: params.branchId,
      horizonDays,
      planningScope,
      scopeWarehouseId,
      ...(params.variantId ? { variantId: params.variantId } : {}),
      ...(params.productId
        ? { variant: { productId: params.productId } }
        : {}),
      ...(params.categoryId
        ? { variant: { product: { categoryId: params.categoryId } } }
        : {}),
    },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
          product: { select: { id: true, name: true, categoryId: true, category: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { computedAt: "desc" },
    take: params.take ?? 200,
  });

  return rows.map((r) => ({
    snapshot: {
      id: r.id,
      branchId: r.branchId,
      variantId: r.variantId,
      horizonDays: r.horizonDays,
      windowDays: r.windowDays,
      forecastUnits: Number(r.forecastUnits),
      avgDailyDemand: Number(r.avgDailyDemand),
      confidence: r.confidence,
      computedAt: r.computedAt,
      planningScope: r.planningScope,
      scopeWarehouseId: r.scopeWarehouseId,
      variant: r.variant,
    },
    explain: {
      method: r.method,
      factors: (r.factorsJson as unknown as ExplainFactor[]) ?? [],
      inputs: (r.inputsJson as Record<string, unknown>) ?? {},
    },
  }));
}

export async function demandTrendSeries(
  branchId: number,
  variantId: number,
  windowDays: number,
  warehouseId?: number
): Promise<{ date: string; units: number }[]> {
  let locationIds: number[];
  if (warehouseId != null && warehouseId > 0) {
    locationIds = await getWarehouseLocationIds(branchId, warehouseId);
  } else {
    locationIds = await getBranchLocationIds(branchId);
  }
  if (!locationIds.length) return [];
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 86400000);

  const rows = await prisma.stockLedger.findMany({
    where: {
      locationId: { in: locationIds },
      variantId,
      createdAt: { gte: windowStart, lte: windowEnd },
      type: { in: [...DEMAND_LEDGER_TYPES] },
      quantityDelta: { lt: 0 },
    },
    select: { createdAt: true, quantityDelta: true },
  });

  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = startOfUtcDay(r.createdAt).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + Math.abs(Number(r.quantityDelta)));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, units]) => ({ date, units }));
}

/** Std-dev of daily demand estimated from weekly totals / sqrt(7). */
export async function estimateDailyDemandStd(
  locationIds: number[],
  variantId: number,
  windowDays: number
): Promise<{ sigmaDaily: number | null; weekCount: number }> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 86400000);
  const byWeek = await weeklyTotalsForVariant(locationIds, variantId, windowStart, windowEnd);
  const totals = [...byWeek.values()];
  if (totals.length < MIN_WEEKS_FOR_DEMAND_VARIANCE) return { sigmaDaily: null, weekCount: totals.length };
  const m = totals.reduce((a, b) => a + b, 0) / totals.length;
  const v = totals.reduce((s, x) => s + (x - m) * (x - m), 0) / totals.length;
  const sigmaWeek = Math.sqrt(v);
  const sigmaDaily = sigmaWeek / Math.sqrt(7);
  return { sigmaDaily: sigmaDaily > 1e-9 ? sigmaDaily : null, weekCount: totals.length };
}
