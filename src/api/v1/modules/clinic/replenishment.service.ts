/**
 * Replenishment recommendations: usage analytics from clinical ledger, reorder suggestions, convert to supply request.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalSupplyRequestService = require("./clinicalSupplyRequest.service");

const RECOMMENDATION_STATUSES = ["PENDING", "CONVERTED_TO_REQUEST", "DISMISSED"] as const;
const CONSUMPTION_TXN_TYPES = ["PACKAGE_CONSUMPTION", "ISSUE_TO_SURGERY", "WASTAGE"];

/** Generate replenishment recommendations for a branch from last N days usage. */
export async function generateRecommendations(
  branchId: number,
  options?: { days?: number; requestedById?: number }
) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  const days = options?.days ?? 30;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const ledgerRows = await prisma.clinicalStockLedger.findMany({
    where: {
      branchId,
      createdAt: { gte: fromDate },
      txnType: { in: CONSUMPTION_TXN_TYPES },
      quantityDelta: { lt: 0 },
    },
    select: {
      clinicalItemId: true,
      variantId: true,
      quantityDelta: true,
    },
  });

  const usageMap = new Map<string, { qty: number }>();
  for (const row of ledgerRows) {
    const key = `${row.clinicalItemId}-${row.variantId}`;
    const current = usageMap.get(key) ?? { qty: 0 };
    current.qty += Math.abs(Number(row.quantityDelta));
    usageMap.set(key, current);
  }

  const stocks = await prisma.branchItemStock.findMany({
    where: { branchId },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
      variant: { select: { id: true, variantName: true } },
    },
  });

  const recommendations: Array<{
    clinicalItemId: number;
    variantId: number | null;
    avgDailyUsage: number;
    avgMonthlyUsage: number;
    currentStock: number;
    reorderLevel: number;
    recommendedQty: number;
  }> = [];

  for (const stock of stocks) {
    const key = `${stock.itemId}-${stock.variantId}`;
    const usage = usageMap.get(key)?.qty ?? 0;
    const avgDailyUsage = usage / days;
    const avgMonthlyUsage = (usage / days) * 30;
    const currentStock = Number(stock.currentQty ?? 0);
    const reorderLevel = Number(stock.reorderLevel ?? 0);
    if (currentStock >= reorderLevel && avgDailyUsage <= 0) continue;
    const recommendedQty = Math.max(0, reorderLevel - currentStock + Math.ceil(avgDailyUsage * 14));
    if (recommendedQty <= 0 && currentStock >= reorderLevel) continue;

    recommendations.push({
      clinicalItemId: stock.itemId,
      variantId: stock.variantId,
      avgDailyUsage,
      avgMonthlyUsage,
      currentStock,
      reorderLevel,
      recommendedQty: recommendedQty || Math.max(1, Math.ceil(avgDailyUsage * 7)),
    });
  }

  const created = [];
  for (const rec of recommendations) {
    const existing = await prisma.replenishmentRecommendation.findFirst({
      where: {
        branchId,
        clinicalItemId: rec.clinicalItemId,
        variantId: rec.variantId,
        status: "PENDING",
      },
    });
    if (existing) continue;
    const row = await prisma.replenishmentRecommendation.create({
      data: {
        orgId: branch.orgId,
        branchId,
        clinicalItemId: rec.clinicalItemId,
        variantId: rec.variantId ?? undefined,
        avgDailyUsage: rec.avgDailyUsage,
        avgMonthlyUsage: rec.avgMonthlyUsage,
        currentStock: rec.currentStock,
        recommendedQty: rec.recommendedQty,
        status: "PENDING",
      },
      include: {
        clinicalItem: { select: { id: true, name: true, itemCode: true } },
        variant: { select: { id: true, variantName: true } },
      },
    });
    created.push(row);
  }

  return { created, total: recommendations.length };
}

/** List pending recommendations for branch. */
export async function listRecommendations(
  branchId: number,
  options?: { status?: string; limit?: number; offset?: number }
) {
  const where: Record<string, unknown> = { branchId };
  if (options?.status) where.status = options.status;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const [items, total] = await Promise.all([
    prisma.replenishmentRecommendation.findMany({
      where,
      include: {
        clinicalItem: { select: { id: true, name: true, itemCode: true } },
        variant: { select: { id: true, variantName: true } },
      },
      orderBy: { recommendedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.replenishmentRecommendation.count({ where }),
  ]);
  return { items, total };
}

/** Convert selected recommendations into a draft supply request. */
export async function convertToSupplyRequest(
  branchId: number,
  recommendationIds: number[],
  requestedById: number
) {
  if (!recommendationIds.length) throw new Error("Select at least one recommendation");
  const recs = await prisma.replenishmentRecommendation.findMany({
    where: { id: { in: recommendationIds }, branchId, status: "PENDING" },
    include: { clinicalItem: true, variant: true },
  });
  if (recs.length === 0) throw new Error("No pending recommendations found");

  const items = recs.map((r) => ({
    clinicalItemId: r.clinicalItemId,
    variantId: r.variantId ?? undefined,
    requestedQty: r.recommendedQty,
  }));

  const request = await clinicalSupplyRequestService.createSupplyRequest(branchId, requestedById, items, {
    priority: "ROUTINE",
    note: "Auto from replenishment recommendations",
  });

  await prisma.replenishmentRecommendation.updateMany({
    where: { id: { in: recommendationIds } },
    data: { status: "CONVERTED_TO_REQUEST" },
  });

  return request;
}

/** Dismiss a recommendation. */
export async function dismissRecommendation(recommendationId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: recommendationId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const rec = await prisma.replenishmentRecommendation.findFirst({ where });
  if (!rec) throw new Error("Recommendation not found");
  if (rec.status !== "PENDING") throw new Error("Only PENDING can be dismissed");

  return prisma.replenishmentRecommendation.update({
    where: { id: recommendationId },
    data: { status: "DISMISSED" },
    include: { clinicalItem: true, variant: true },
  });
}
