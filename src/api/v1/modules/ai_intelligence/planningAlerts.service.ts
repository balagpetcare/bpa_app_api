import prisma from "../../../../infrastructure/db/prismaClient";

export type PlanningAlertItem = {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  type: string;
  title: string;
  detail: string;
  branchId?: number;
  branchName?: string | null;
  variantId?: number;
  sku?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Unified alerts for procurement / inventory planning (read-only; no side effects).
 */
export async function getPlanningAlertsForOrg(orgId: number): Promise<{ alerts: PlanningAlertItem[]; explain: { source: string } }> {
  const branches = await prisma.branch.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const branchIds = branches.map((b) => b.id);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const alerts: PlanningAlertItem[] = [];

  const critical = await prisma.aiReplenishmentSuggestion.findMany({
    where: { orgId, status: "OPEN", severity: "CRITICAL" },
    include: {
      branch: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });

  for (const r of critical) {
    alerts.push({
      id: `rep-crit-${r.id}`,
      severity: "HIGH",
      type: "REPLENISHMENT_CRITICAL",
      title: `Critical reorder: ${r.variant?.sku ?? r.variantId}`,
      detail: `Suggested ${r.suggestedQty} units — projected stockout or below ROP.`,
      branchId: r.branchId,
      branchName: r.branch?.name,
      variantId: r.variantId,
      sku: r.variant?.sku ?? null,
      meta: { suggestionId: r.id, reasonCodes: r.reasonCodes },
    });
  }

  const warnings = await prisma.aiReplenishmentSuggestion.findMany({
    where: { orgId, status: "OPEN", severity: "WARNING" },
    include: {
      branch: { select: { name: true } },
      variant: { select: { sku: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  for (const r of warnings) {
    alerts.push({
      id: `rep-warn-${r.id}`,
      severity: "MEDIUM",
      type: "REPLENISHMENT_WARNING",
      title: `Reorder suggested: ${r.variant?.sku ?? r.variantId}`,
      detail: `Suggested ${r.suggestedQty} units.`,
      branchId: r.branchId,
      branchName: r.branch?.name,
      variantId: r.variantId,
      sku: r.variant?.sku ?? null,
      meta: { suggestionId: r.id },
    });
  }

  const lowConf = await prisma.aiForecastSnapshot.findMany({
    where: {
      orgId,
      branchId: { in: branchIds },
      confidence: { lt: 0.35 },
      planningScope: "BRANCH",
      scopeWarehouseId: 0,
    },
    include: { variant: { select: { sku: true } }, branch: { select: { name: true } } },
    take: 20,
  });
  for (const s of lowConf) {
    alerts.push({
      id: `fc-low-${s.id}`,
      severity: "LOW",
      type: "FORECAST_LOW_CONFIDENCE",
      title: `Low confidence forecast: ${s.variant?.sku ?? s.variantId}`,
      detail: "Sparse or volatile history — review before trusting automated quantities.",
      branchId: s.branchId,
      branchName: s.branch?.name,
      variantId: s.variantId,
      sku: s.variant?.sku ?? null,
      meta: { confidence: s.confidence },
    });
  }

  const delayedGrns = await prisma.grn.findMany({
    where: {
      orgId,
      vendorId: { not: null },
      receivedAt: { not: null },
      purchaseOrderId: { not: null },
    },
    include: {
      purchaseOrder: { select: { expectedDeliveryDate: true, poNumber: true } },
      vendor: { select: { name: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 60,
  });

  let delayCount = 0;
  for (const g of delayedGrns) {
    const exp = g.purchaseOrder?.expectedDeliveryDate;
    if (!exp || !g.receivedAt) continue;
    if (g.receivedAt.getTime() <= exp.getTime()) continue;
    if (delayCount >= 12) break;
    delayCount++;
    alerts.push({
      id: `po-delay-${g.id}`,
      severity: "MEDIUM",
      type: "PROCUREMENT_DELAY",
      title: `Late receive vs PO expectation`,
      detail: `Vendor ${g.vendor?.name ?? g.vendorId} — GRN ${g.id}${g.purchaseOrder?.poNumber ? ` (PO ${g.purchaseOrder.poNumber})` : ""}.`,
      meta: {
        grnId: g.id,
        vendorId: g.vendorId,
        expectedDeliveryDate: exp.toISOString(),
        receivedAt: g.receivedAt.toISOString(),
      },
    });
  }

  alerts.sort((a, b) => {
    const rank = (s: string) => (s === "HIGH" ? 0 : s === "MEDIUM" ? 1 : 2);
    return rank(a.severity) - rank(b.severity);
  });

  return {
    alerts,
    explain: { source: "AiReplenishmentSuggestion + AiForecastSnapshot + Grn vs PurchaseOrder" },
  };
}
