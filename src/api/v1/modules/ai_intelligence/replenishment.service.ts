import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  DEFAULT_HORIZON_DAYS,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_SAFETY_DAYS,
  DEFAULT_SERVICE_LEVEL_Z,
  DEFAULT_WINDOW_DAYS,
} from "./aiConstants";
import type { ExplainFactor } from "./aiExplainability";
import {
  aggregateConsumptionByVariant,
  estimateDailyDemandStd,
  getBranchLocationIds,
} from "./aiForecast.service";

const stockRequestsService = require("../stock_requests/stock_requests.service");

const PENDING_STOCK_REQUEST_STATUSES = [
  "SUBMITTED",
  "OWNER_REVIEW",
  "APPROVED",
  "FULFILLED_PARTIAL",
  "PARTIALLY_DISPATCHED",
  "DISPATCHED",
  "RECEIVED_PARTIAL",
  "RECEIVED_FULL",
  "PARTIALLY_RECEIVED",
] as const;

export const REPLENISH_REASON_LABELS: Record<string, string> = {
  AT_OR_BELOW_ROP: "Stock is at or below the effective reorder point (configured or derived).",
  PROJECTED_STOCKOUT: "Projected on-hand plus inbound will not cover demand through the forecast horizon.",
  SERVICE_LEVEL_BUFFER: "Safety stock includes a service-level buffer from demand variability (when data allows).",
};

function utcDayBucket(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function inboundPipelineUnits(orgId: number, branchId: number, variantId: number): Promise<number> {
  const items = await prisma.stockRequestItem.findMany({
    where: {
      variantId,
      stockRequest: {
        orgId,
        branchId,
        status: { in: [...PENDING_STOCK_REQUEST_STATUSES] },
      },
    },
    select: {
      requestedQty: true,
      fulfilledQty: true,
      cancelledQty: true,
    },
  });
  let sum = 0;
  for (const it of items) {
    const rem = it.requestedQty - it.fulfilledQty - (it.cancelledQty ?? 0);
    if (rem > 0) sum += rem;
  }
  return sum;
}

async function branchOnHandForVariant(branchId: number, variantId: number): Promise<number> {
  const locIds = await getBranchLocationIds(branchId);
  if (!locIds.length) return 0;
  const balances = await prisma.stockBalance.findMany({
    where: { locationId: { in: locIds }, variantId },
    select: { onHandQty: true },
  });
  return balances.reduce((s, b) => s + b.onHandQty, 0);
}

async function resolveLeadSafetyOverrides(
  orgId: number,
  branchId: number,
  variantId: number
): Promise<{ leadTimeDays: number; safetyDays: number }> {
  const rows = await prisma.aiRecommendationOverride.findMany({
    where: {
      orgId,
      variantId,
      OR: [{ branchId }, { branchId: null }],
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  let lead = DEFAULT_LEAD_TIME_DAYS;
  let safety = DEFAULT_SAFETY_DAYS;
  const branchSpecific = rows.find((r) => r.branchId === branchId);
  const orgWide = rows.find((r) => r.branchId == null);
  const pick = branchSpecific ?? orgWide;
  if (pick?.leadTimeDays != null) lead = pick.leadTimeDays;
  if (pick?.safetyDays != null) safety = pick.safetyDays;
  return { leadTimeDays: lead, safetyDays: safety };
}

async function effectiveRop(
  branchId: number,
  variantId: number,
  avgDaily: number,
  leadTimeDays: number,
  safetyDays: number,
  windowDays: number
): Promise<{
  rop: number;
  orderUpTo: number | null;
  factors: ExplainFactor[];
  serviceLevelUnits: number;
}> {
  const locIds = await getBranchLocationIds(branchId);
  const configs = await prisma.locationVariantConfig.findMany({
    where: { locationId: { in: locIds }, variantId },
    select: { reorderPoint: true, minStock: true, maxStock: true },
  });
  let rop = 0;
  let maxStock: number | null = null;
  for (const c of configs) {
    const rp = c.reorderPoint ?? c.minStock ?? 0;
    rop = Math.max(rop, rp);
    if (c.maxStock != null) maxStock = maxStock == null ? c.maxStock : Math.max(maxStock, c.maxStock);
  }

  const { sigmaDaily } = await estimateDailyDemandStd(locIds, variantId, windowDays);
  const z = DEFAULT_SERVICE_LEVEL_Z;
  const leadTimeDemandVarianceBuffer =
    sigmaDaily != null && sigmaDaily > 0 ? z * sigmaDaily * Math.sqrt(Math.max(1, leadTimeDays)) : 0;
  const fixedSafetyUnits = safetyDays * avgDaily;
  const serviceLevelUnits = Math.max(fixedSafetyUnits, leadTimeDemandVarianceBuffer);

  const derivedRop = Math.ceil(avgDaily * leadTimeDays + serviceLevelUnits);
  if (rop <= 0) rop = derivedRop;

  const factors: ExplainFactor[] = [
    { name: "leadTimeDays", value: leadTimeDays, description: "Lead time cover for inbound supply" },
    { name: "safetyDays", value: safetyDays, description: "Configured extra days of cover (override or default)" },
    { name: "serviceLevelUnits", value: serviceLevelUnits, description: "Safety buffer: max(fixed safety, z·σ·√L)" },
    { name: "sigmaDailyEstimate", value: sigmaDaily ?? 0, description: "Estimated daily demand std-dev from weekly ledger buckets" },
    { name: "configuredRop", value: rop, description: "Max configured reorder point across locations, else derived ROP" },
  ];

  const targetCoverUnits = avgDaily * leadTimeDays + serviceLevelUnits;
  let orderUpTo: number | null = Math.ceil(targetCoverUnits);
  if (maxStock != null) orderUpTo = Math.min(orderUpTo, maxStock);
  return { rop, orderUpTo, factors, serviceLevelUnits };
}

export async function computeSuggestionForVariant(
  orgId: number,
  branchId: number,
  variantId: number,
  productId: number,
  options?: { leadTimeDays?: number; safetyDays?: number; horizonDays?: number; windowDays?: number }
): Promise<{
  suggestedQty: number;
  onHand: number;
  rop: number;
  orderUpTo: number | null;
  inbound: number;
  reasonCodes: string[];
  severity: string;
  meta: Record<string, unknown>;
} | null> {
  const windowDays = options?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const horizonDays = options?.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const ov = await resolveLeadSafetyOverrides(orgId, branchId, variantId);
  const leadTimeDays = options?.leadTimeDays ?? ov.leadTimeDays;
  const safetyDays = options?.safetyDays ?? ov.safetyDays;

  const locIds = await getBranchLocationIds(branchId);
  const { byVariant } = await aggregateConsumptionByVariant(locIds, windowDays);
  const total = byVariant.get(variantId) ?? 0;
  const spanDays = windowDays;
  const avgDaily = total / Math.max(1, spanDays);

  const onHand = await branchOnHandForVariant(branchId, variantId);
  const inbound = await inboundPipelineUnits(orgId, branchId, variantId);
  const { rop, orderUpTo, factors, serviceLevelUnits } = await effectiveRop(
    branchId,
    variantId,
    avgDaily,
    leadTimeDays,
    safetyDays,
    windowDays
  );

  const projectedEnd = onHand + inbound - avgDaily * horizonDays;
  const reasonCodes: string[] = [];
  if (onHand + inbound <= rop) reasonCodes.push("AT_OR_BELOW_ROP");
  if (projectedEnd < 0) reasonCodes.push("PROJECTED_STOCKOUT");
  if (serviceLevelUnits > safetyDays * avgDaily + 1e-6) reasonCodes.push("SERVICE_LEVEL_BUFFER");
  if (reasonCodes.length === 0) return null;

  const target = orderUpTo ?? Math.ceil(avgDaily * leadTimeDays + serviceLevelUnits);
  const suggestedQty = Math.max(0, target - onHand - inbound);
  if (suggestedQty <= 0) return null;

  const severity = projectedEnd < 0 ? "CRITICAL" : "WARNING";
  return {
    suggestedQty,
    onHand,
    rop,
    orderUpTo,
    inbound,
    reasonCodes,
    severity,
    meta: {
      avgDailyDemand: avgDaily,
      horizonDays,
      leadTimeDays,
      safetyDays,
      serviceLevelUnits,
      factors,
      method: "REORDER_POINT_PIPELINE",
      explainSummary: reasonCodes.map((c) => REPLENISH_REASON_LABELS[c] ?? c),
    },
  };
}

function hashSuggestion(orgId: number, branchId: number, variantId: number, day: Date): string {
  return createHash("sha256")
    .update(`${orgId}|${branchId}|${variantId}|${day.toISOString().slice(0, 10)}`)
    .digest("hex")
    .slice(0, 32);
}

export async function refreshReplenishmentSuggestionsForBranch(
  orgId: number,
  branchId: number
): Promise<{ created: number }> {
  const locIds = await getBranchLocationIds(branchId);
  const { byVariant } = await aggregateConsumptionByVariant(locIds, DEFAULT_WINDOW_DAYS);
  const dayBucket = utcDayBucket(new Date());
  let created = 0;

  const variantIds = [...byVariant.keys()];
  if (!variantIds.length) return { created: 0 };
  const productByVariant = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { orgId } },
    select: { id: true, productId: true },
  });
  const productMap = new Map(productByVariant.map((p) => [p.id, p.productId]));

  for (const variantId of byVariant.keys()) {
    const productId = productMap.get(variantId);
    if (!productId) continue;
    const sug = await computeSuggestionForVariant(orgId, branchId, variantId, productId);
    if (!sug) continue;
    const h = hashSuggestion(orgId, branchId, variantId, dayBucket);
    await prisma.aiReplenishmentSuggestion.upsert({
      where: {
        orgId_branchId_variantId_dayBucket: {
          orgId,
          branchId,
          variantId,
          dayBucket,
        },
      },
      create: {
        orgId,
        branchId,
        variantId,
        productId,
        suggestedQty: sug.suggestedQty,
        onHand: sug.onHand,
        rop: sug.rop,
        orderUpTo: sug.orderUpTo,
        reasonCodes: sug.reasonCodes,
        severity: sug.severity,
        status: "OPEN",
        suggestionHash: h,
        dayBucket,
        metaJson: sug.meta as Prisma.InputJsonValue,
      },
      update: {
        suggestedQty: sug.suggestedQty,
        onHand: sug.onHand,
        rop: sug.rop,
        orderUpTo: sug.orderUpTo,
        reasonCodes: sug.reasonCodes,
        severity: sug.severity,
        metaJson: sug.meta as Prisma.InputJsonValue,
        suggestionHash: h,
      },
    });
    created++;
  }
  return { created };
}

function enrichRow(r: Record<string, unknown>) {
  const codes = (r.reasonCodes as string[]) ?? [];
  return {
    ...r,
    reasonLabels: codes.map((c) => REPLENISH_REASON_LABELS[c] ?? c),
  };
}

export async function listSuggestions(params: {
  orgId: number;
  branchId: number;
  status?: "OPEN" | "ACCEPTED" | "DISMISSED" | "ALL";
}): Promise<any[]> {
  const rows = await prisma.aiReplenishmentSuggestion.findMany({
    where: {
      orgId: params.orgId,
      branchId: params.branchId,
      ...(params.status && params.status !== "ALL" ? { status: params.status } : {}),
    },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      product: { select: { id: true, name: true } },
    },
    orderBy: [{ severity: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
  return rows.map((r) => enrichRow(r as unknown as Record<string, unknown>));
}

export async function dismissSuggestion(
  id: number,
  orgId: number,
  userId: number
): Promise<void> {
  const row = await prisma.aiReplenishmentSuggestion.findFirst({
    where: { id, orgId },
  });
  if (!row) throw new Error("Suggestion not found");
  await prisma.aiReplenishmentSuggestion.update({
    where: { id },
    data: {
      status: "DISMISSED",
      metaJson: {
        ...(typeof row.metaJson === "object" && row.metaJson ? row.metaJson : {}),
        dismissedByUserId: userId,
        dismissedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.aiRecommendationOverride.create({
    data: {
      orgId,
      branchId: row.branchId,
      userId,
      variantId: row.variantId,
      scope: "VARIANT",
      notes: "dismiss_replenishment_suggestion",
    },
  });
}

export async function bulkDismissSuggestions(
  ids: number[],
  orgId: number,
  userId: number
): Promise<{ dismissed: number; errors: string[] }> {
  const errors: string[] = [];
  let dismissed = 0;
  for (const id of ids) {
    try {
      await dismissSuggestion(id, orgId, userId);
      dismissed++;
    } catch (e: any) {
      errors.push(`id ${id}: ${e?.message || "failed"}`);
    }
  }
  return { dismissed, errors };
}

export async function acceptSuggestion(
  id: number,
  orgId: number,
  requesterUserId: number
): Promise<{ stockRequest: unknown }> {
  const row = await prisma.aiReplenishmentSuggestion.findFirst({
    where: { id, orgId, status: "OPEN" },
    include: { variant: { select: { productId: true } } },
  });
  if (!row) throw new Error("Suggestion not found or not open");

  const req = await stockRequestsService.createRequest({
    orgId,
    branchId: row.branchId,
    requesterUserId,
    items: [
      {
        productId: row.productId,
        variantId: row.variantId,
        requestedQty: row.suggestedQty,
        note: "AI replenishment (draft — review before submit)",
      },
    ],
  });

  await prisma.aiReplenishmentSuggestion.update({
    where: { id },
    data: {
      status: "ACCEPTED",
      stockRequestId: req.id,
      metaJson: {
        ...(typeof row.metaJson === "object" && row.metaJson ? row.metaJson : {}),
        stockRequestCreatedId: req.id,
        acceptedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  return { stockRequest: req };
}

export async function bulkAcceptSuggestions(
  ids: number[],
  orgId: number,
  requesterUserId: number
): Promise<{ accepted: number; stockRequestIds: number[]; errors: string[] }> {
  const errors: string[] = [];
  const stockRequestIds: number[] = [];
  let accepted = 0;
  for (const id of ids) {
    try {
      const r = await acceptSuggestion(id, orgId, requesterUserId);
      const sid = (r.stockRequest as { id?: number })?.id;
      if (sid != null) stockRequestIds.push(sid);
      accepted++;
    } catch (e: any) {
      errors.push(`id ${id}: ${e?.message || "failed"}`);
    }
  }
  return { accepted, stockRequestIds, errors };
}

export async function maybeAutoDraftStockRequest(
  orgId: number,
  branchId: number,
  requesterUserId: number | null
): Promise<{ created: number }> {
  if (process.env.AI_AUTO_DRAFT_STOCK_REQUEST !== "true" || !requesterUserId) {
    return { created: 0 };
  }
  const open = await prisma.aiReplenishmentSuggestion.findMany({
    where: { orgId, branchId, status: "OPEN", severity: "CRITICAL" },
    take: 20,
  });
  let created = 0;
  for (const s of open) {
    try {
      await acceptSuggestion(s.id, orgId, requesterUserId);
      created++;
    } catch {
      /* ignore */
    }
  }
  return { created };
}
