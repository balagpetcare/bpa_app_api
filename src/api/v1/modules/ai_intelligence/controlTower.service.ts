import prisma from "../../../../infrastructure/db/prismaClient";

export async function getControlTowerOverview(orgId: number) {
  const branches = await prisma.branch.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const branchIds = branches.map((b) => b.id);

  const [openSuggestions, snapshots, lowConfidence] = await Promise.all([
    prisma.aiReplenishmentSuggestion.count({
      where: { orgId, status: "OPEN", severity: "CRITICAL" },
    }),
    prisma.aiForecastSnapshot.count({
      where: { orgId, branchId: { in: branchIds }, planningScope: "BRANCH", scopeWarehouseId: 0 },
    }),
    prisma.aiForecastSnapshot.count({
      where: {
        orgId,
        branchId: { in: branchIds },
        confidence: { lt: 0.35 },
        planningScope: "BRANCH",
        scopeWarehouseId: 0,
      },
    }),
  ]);

  const criticalRows = await prisma.aiReplenishmentSuggestion.findMany({
    where: { orgId, status: "OPEN", severity: "CRITICAL" },
    include: {
      branch: { select: { id: true, name: true } },
      variant: { select: { sku: true, title: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });

  const topActions = criticalRows.slice(0, 5).map((r) => ({
    type: "replenishment",
    branchId: r.branchId,
    branchName: r.branch?.name,
    variantId: r.variantId,
    sku: r.variant?.sku,
    title: r.variant?.title,
    suggestedQty: r.suggestedQty,
    reasons: r.reasonCodes,
  }));

  return {
    kpis: {
      branchesMonitored: branches.length,
      forecastSnapshots: snapshots,
      criticalReplenishmentLines: openSuggestions,
      lowConfidenceForecasts: lowConfidence,
    },
    alerts: criticalRows.map((r) => ({
      id: r.id,
      severity: r.severity,
      branchId: r.branchId,
      branchName: r.branch?.name,
      variantId: r.variantId,
      sku: r.variant?.sku,
      message: `Suggested reorder ${r.suggestedQty} units — ${(r.reasonCodes as string[])?.join(", ")}`,
    })),
    topRecommendations: topActions,
    explain: {
      method: "AGGREGATE_DB_COUNTS",
      note: "KPIs are derived from AiForecastSnapshot and AiReplenishmentSuggestion tables.",
    },
  };
}
