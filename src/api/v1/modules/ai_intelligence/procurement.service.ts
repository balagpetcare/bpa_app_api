import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { DEFAULT_WINDOW_DAYS } from "./aiConstants";
import { aggregateConsumptionByVariant, getBranchLocationIds } from "./aiForecast.service";

const WEIGHTS = { price: 0.32, reliability: 0.28, quality: 0.18, leadTime: 0.12, ledger: 0.1 };

export type VendorOption = {
  vendorId: number;
  vendorName: string;
  listingId: number | null;
  unitPrice: number | null;
  score: number;
  reasonCodes: string[];
  components: Record<string, number>;
  avgLeadTimeDays: number | null;
  delayedReceiveCount: number;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function grnReliabilityScore(orgId: number, vendorId: number): Promise<{ score: number; detail: string }> {
  const grns = await prisma.grn.findMany({
    where: { orgId, vendorId, receivedAt: { not: null } },
    select: { createdAt: true, receivedAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  if (grns.length < 2) return { score: 0.5, detail: "insufficient_grn_history" };
  const deltas: number[] = [];
  for (const g of grns) {
    if (g.receivedAt) deltas.push(g.receivedAt.getTime() - g.createdAt.getTime());
  }
  if (deltas.length < 2) return { score: 0.5, detail: "sparse_receive_times" };
  const m = median(deltas.map((d) => d / 86400000));
  const v = deltas.reduce((s, x) => s + Math.pow(x / 86400000 - m, 2), 0) / deltas.length;
  const cv = m > 1e-6 ? Math.sqrt(v) / m : 0;
  const score = Math.max(0, 1 - Math.min(1, cv));
  return { score, detail: "grn_lead_time_consistency" };
}

async function avgLeadTimeDaysForVendor(orgId: number, vendorId: number): Promise<number | null> {
  const grns = await prisma.grn.findMany({
    where: { orgId, vendorId, receivedAt: { not: null } },
    select: { createdAt: true, receivedAt: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  if (!grns.length) return null;
  const days = grns
    .map((g) => (g.receivedAt!.getTime() - g.createdAt.getTime()) / 86400000)
    .filter((d) => d >= 0);
  if (!days.length) return null;
  return days.reduce((a, b) => a + b, 0) / days.length;
}

async function delayedReceiveCountForVendor(orgId: number, vendorId: number): Promise<number> {
  const grns = await prisma.grn.findMany({
    where: {
      orgId,
      vendorId,
      receivedAt: { not: null },
      purchaseOrderId: { not: null },
    },
    include: {
      purchaseOrder: { select: { expectedDeliveryDate: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  let n = 0;
  for (const g of grns) {
    const exp = g.purchaseOrder?.expectedDeliveryDate;
    if (!exp || !g.receivedAt) continue;
    if (g.receivedAt.getTime() > exp.getTime()) n++;
  }
  return n;
}

async function returnPenalty(orgId: number, vendorId: number): Promise<number> {
  const [returns, grnCount] = await Promise.all([
    prisma.vendorReturn.count({ where: { orgId, vendorId } }),
    prisma.grn.count({ where: { orgId, vendorId, stockDispatchId: null } }),
  ]);
  if (grnCount === 0) return 0.5;
  const rate = returns / Math.max(1, grnCount);
  return Math.max(0, 1 - Math.min(1, rate * 2));
}

async function shortageRiskScore(orgId: number, branchId: number, variantId: number): Promise<number> {
  const row = await prisma.aiReplenishmentSuggestion.findFirst({
    where: {
      orgId,
      branchId,
      variantId,
      status: "OPEN",
      severity: "CRITICAL",
    },
    select: { id: true },
  });
  return row ? 1 : 0.2;
}

export async function rankVendorsForVariant(
  orgId: number,
  branchId: number,
  variantId: number
): Promise<{
  ranked: VendorOption[];
  weights: typeof WEIGHTS;
  explain: Record<string, unknown>;
}> {
  const listings = await prisma.vendorProductListing.findMany({
    where: {
      variantId,
      status: "APPROVED",
      vendor: { orgId },
    },
    include: { vendor: { select: { id: true, name: true } } },
    take: 20,
  });

  if (!listings.length) {
    return {
      ranked: [],
      weights: WEIGHTS,
      explain: {
        medianPeerPrice: 0,
        listingCount: 0,
        method: "WEIGHTED_LINEAR_SCORE",
        code: "NO_APPROVED_LISTING",
      },
    };
  }

  const shortageRiskAtBranch = await shortageRiskScore(orgId, branchId, variantId);

  const vendorIds = [...new Set(listings.map((l) => l.vendorId))];
  const recentCosts = await prisma.grnLine.findMany({
    where: {
      variantId,
      grn: { orgId, vendorId: { in: vendorIds } },
      unitCost: { not: null },
    },
    select: { unitCost: true, grn: { select: { vendorId: true } } },
    orderBy: { id: "desc" },
    take: 200,
  });
  const costByVendor = new Map<number, number[]>();
  for (const line of recentCosts) {
    const vid = line.grn.vendorId;
    if (vid == null) continue;
    const arr = costByVendor.get(vid) ?? [];
    arr.push(Number(line.unitCost));
    costByVendor.set(vid, arr);
  }

  const priceByVendor = new Map<number, number | null>();
  for (const vid of vendorIds) {
    const arr = costByVendor.get(vid);
    priceByVendor.set(vid, arr?.length ? median(arr) : null);
  }
  const prices = [...priceByVendor.values()].filter((p): p is number => p != null && p > 0);
  const med = median(prices);

  const ranked: VendorOption[] = [];
  for (const l of listings) {
    const vendorId = l.vendorId;
    const unitPrice = priceByVendor.get(vendorId) ?? null;
    const priceScore =
      unitPrice != null && med > 0 ? Math.max(0, 1 - Math.min(1, unitPrice / (2 * med))) : 0.5;
    const rel = await grnReliabilityScore(orgId, vendorId);
    const qual = await returnPenalty(orgId, vendorId);
    const ledgerScore = 0.5;
    const avgLt = await avgLeadTimeDaysForVendor(orgId, vendorId);
    const leadTimeScore =
      avgLt != null ? Math.max(0, 1 - Math.min(1, avgLt / 30)) : 0.5;
    const delayedCt = await delayedReceiveCountForVendor(orgId, vendorId);
    const delayPenalty = Math.max(0, 1 - Math.min(1, delayedCt / 10));

    const score =
      WEIGHTS.price * priceScore +
      WEIGHTS.reliability * rel.score +
      WEIGHTS.quality * qual +
      WEIGHTS.leadTime * leadTimeScore * delayPenalty +
      WEIGHTS.ledger * ledgerScore;

    ranked.push({
      vendorId,
      vendorName: l.vendor.name,
      listingId: l.id,
      unitPrice,
      score,
      reasonCodes: [
        rel.detail,
        unitPrice != null && med > 0 ? "price_vs_median" : "price_unknown",
        avgLt != null ? "lead_time_observed" : "lead_time_unknown",
        delayedCt > 0 ? "delayed_po_receives" : "on_time_history",
      ],
      components: {
        priceScore,
        reliability: rel.score,
        quality: qual,
        ledger: ledgerScore,
        leadTime: leadTimeScore,
        delayPenalty,
        shortageContext: shortageRiskAtBranch,
      },
      avgLeadTimeDays: avgLt,
      delayedReceiveCount: delayedCt,
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  return {
    ranked,
    weights: WEIGHTS,
    explain: {
      medianPeerPrice: med,
      listingCount: listings.length,
      method: "WEIGHTED_LINEAR_SCORE",
      shortageRiskAtBranch,
    },
  };
}

export async function upsertProcurementRecommendation(orgId: number, branchId: number, variantId: number) {
  const { ranked, weights, explain } = await rankVendorsForVariant(orgId, branchId, variantId);
  await prisma.aiProcurementRecommendation.upsert({
    where: {
      orgId_branchId_variantId: { orgId, branchId, variantId },
    },
    create: {
      orgId,
      branchId,
      variantId,
      rankedVendorsJson: ranked as unknown as Prisma.InputJsonValue,
      scoresJson: explain as unknown as Prisma.InputJsonValue,
      weightsJson: weights as unknown as Prisma.InputJsonValue,
    },
    update: {
      rankedVendorsJson: ranked as unknown as Prisma.InputJsonValue,
      scoresJson: explain as unknown as Prisma.InputJsonValue,
      weightsJson: weights as unknown as Prisma.InputJsonValue,
      computedAt: new Date(),
    },
  });
}

export async function refreshProcurementForBranch(orgId: number, branchId: number): Promise<{ processed: number }> {
  const locIds = await getBranchLocationIds(branchId);
  const { byVariant } = await aggregateConsumptionByVariant(locIds, DEFAULT_WINDOW_DAYS);
  let processed = 0;
  for (const variantId of byVariant.keys()) {
    await upsertProcurementRecommendation(orgId, branchId, variantId);
    processed++;
  }
  return { processed };
}

export async function listProcurementRecommendations(orgId: number, branchId: number) {
  const rows = await prisma.aiProcurementRecommendation.findMany({
    where: { orgId, branchId },
    include: {
      variant: { select: { id: true, sku: true, title: true, product: { select: { name: true } } } },
    },
    orderBy: { computedAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    variantId: r.variantId,
    computedAt: r.computedAt,
    variant: r.variant,
    rankedVendors: r.rankedVendorsJson,
    scores: r.scoresJson,
    weights: r.weightsJson,
  }));
}

export async function getGrnPriceHistory(params: {
  orgId: number;
  variantId: number;
  vendorId?: number;
  limit?: number;
}): Promise<
  Array<{
    grnId: number;
    receivedAt: string | null;
    unitCost: number | null;
    quantity: number;
    vendorId: number | null;
    vendorName: string | null;
  }>
> {
  const limit = params.limit ?? 60;
  const lines = await prisma.grnLine.findMany({
    where: {
      variantId: params.variantId,
      grn: {
        orgId: params.orgId,
        vendorId: params.vendorId != null ? params.vendorId : { not: null },
      },
      unitCost: { not: null },
    },
    select: {
      quantity: true,
      unitCost: true,
      grn: {
        select: {
          id: true,
          receivedAt: true,
          vendorId: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { id: "desc" },
    take: limit,
  });
  return lines.map((l) => ({
    grnId: l.grn.id,
    receivedAt: l.grn.receivedAt?.toISOString() ?? null,
    unitCost: l.unitCost != null ? Number(l.unitCost) : null,
    quantity: l.quantity,
    vendorId: l.grn.vendorId,
    vendorName: l.grn.vendor?.name ?? null,
  }));
}

export async function getVendorLeadTimeHistory(orgId: number, vendorId: number, limit = 40) {
  const grns = await prisma.grn.findMany({
    where: { orgId, vendorId, receivedAt: { not: null } },
    select: { id: true, createdAt: true, receivedAt: true, purchaseOrderId: true, purchaseOrder: { select: { expectedDeliveryDate: true, poNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return grns.map((g) => {
    const leadDays =
      g.receivedAt && g.createdAt
        ? (g.receivedAt.getTime() - g.createdAt.getTime()) / 86400000
        : null;
    const expected = g.purchaseOrder?.expectedDeliveryDate;
    const delayed =
      expected && g.receivedAt ? g.receivedAt.getTime() > expected.getTime() : false;
    return {
      grnId: g.id,
      createdAt: g.createdAt.toISOString(),
      receivedAt: g.receivedAt?.toISOString() ?? null,
      leadTimeDays: leadDays,
      expectedDeliveryDate: expected?.toISOString() ?? null,
      delayedVsPo: delayed,
      poNumber: g.purchaseOrder?.poNumber ?? null,
    };
  });
}
