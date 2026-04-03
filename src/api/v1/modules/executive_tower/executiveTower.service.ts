import { KPI_REGISTRY, getKpiDefinition } from "./kpiRegistry";

const prisma = require("../../../../infrastructure/db/prismaClient").default;
const controlTowerService = require("../ai_intelligence/controlTower.service");

const ENGINE_VERSION = "executive-tower.v1";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function drilldownQueryForKpi(kpiKey: string, orgId: number, branchId?: number): Record<string, unknown> {
  const q: Record<string, unknown> = { orgId };
  if (branchId != null) q.branchId = branchId;
  return { kpiKey, filters: q };
}

export async function getExecutiveOverview(orgId: number) {
  const kpis = await buildKpiRows(orgId, {});
  const [pendingPackages, legacy] = await Promise.all([
    prisma.decisionPackage.count({
      where: {
        orgId,
        status: { in: ["PROPOSED", "PENDING_APPROVAL"] },
      },
    }),
    controlTowerService.getControlTowerOverview(orgId),
  ]);
  const alerts = await buildCorrelatedAlerts(orgId, legacy);

  return {
    generatedAt: new Date().toISOString(),
    orgId,
    kpis,
    alerts,
    decisionPackages: { pendingCount: pendingPackages },
    legacyControlTower: legacy,
    explain: {
      engineVersion: ENGINE_VERSION,
      note: "KPIs aggregate read-only domain tables; no ledger writes.",
    },
  };
}

type BuildOpts = { branchId?: number };

async function buildKpiRows(orgId: number, opts: BuildOpts) {
  const allBranchRows = await prisma.branch.findMany({
    where: { orgId },
    select: { id: true },
  });
  const allBranchIds = allBranchRows.map((b: { id: number }) => b.id);
  const branchIds =
    opts.branchId != null
      ? allBranchIds.includes(opts.branchId)
        ? [opts.branchId]
        : []
      : allBranchIds;

  const forecastWhere =
    branchIds.length > 0
      ? {
          orgId,
          branchId: { in: branchIds },
          planningScope: "BRANCH" as const,
          scopeWarehouseId: 0,
        }
      : {
          orgId,
          branchId: -1,
          planningScope: "BRANCH" as const,
          scopeWarehouseId: 0,
        };

  const seven = daysAgo(7);
  const bf = opts.branchId;
  const branchOrOrg = bf
    ? {
        replenishment: { orgId, branchId: bf, status: "OPEN" as const, severity: "CRITICAL" as const },
        stockRequest: {
          orgId,
          branchId: bf,
          status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] as const },
        },
        dispatch: {
          orgId,
          status: { in: ["CREATED", "PACKED", "IN_TRANSIT"] as const },
          toLocation: { branchId: bf },
        },
        wto: {
          orgId,
          status: { not: "CLOSED" as const },
          OR: [{ fromLocation: { branchId: bf } }, { toLocation: { branchId: bf } }],
        },
        grn: { orgId, createdAt: { gte: seven }, location: { branchId: bf } },
        vendorRet: { orgId, status: { notIn: ["CREDITED", "CANCELLED"] as const }, location: { branchId: bf } },
        discrepancy: {
          orgId,
          status: "PENDING" as const,
          stockDispatch: { toLocation: { branchId: bf } },
        },
      }
    : null;

  const [
    forecastTotal,
    forecastLow,
    criticalReplenishment,
    openStockRequests,
    dispatchesInFlight,
    wtoPipeline,
    openPOs,
    grn7d,
    vendorReturnsOpen,
    activeRecalls,
    pendingDiscrepancies,
  ] = await Promise.all([
    prisma.aiForecastSnapshot.count({ where: forecastWhere }),
    prisma.aiForecastSnapshot.count({
      where: {
        ...forecastWhere,
        confidence: { lt: 0.35 },
      },
    }),
    prisma.aiReplenishmentSuggestion.count({
      where: branchOrOrg
        ? branchOrOrg.replenishment
        : { orgId, status: "OPEN", severity: "CRITICAL" },
    }),
    prisma.stockRequest.count({
      where: branchOrOrg ? branchOrOrg.stockRequest : { orgId, status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] } },
    }),
    prisma.stockDispatch.count({
      where: branchOrOrg
        ? branchOrOrg.dispatch
        : { orgId, status: { in: ["CREATED", "PACKED", "IN_TRANSIT"] } },
    }),
    prisma.warehouseTransferOrder.count({
      where: branchOrOrg ? branchOrOrg.wto : { orgId, status: { not: "CLOSED" } },
    }),
    prisma.purchaseOrder.count({
      where: {
        orgId,
        status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"] },
      },
    }),
    prisma.grn.count({
      where: branchOrOrg ? branchOrOrg.grn : { orgId, createdAt: { gte: seven } },
    }),
    prisma.vendorReturn.count({
      where: branchOrOrg
        ? branchOrOrg.vendorRet
        : { orgId, status: { notIn: ["CREDITED", "CANCELLED"] } },
    }),
    prisma.batchRecall.count({
      where: { orgId, status: { in: ["ACTIVE", "QUARANTINED"] } },
    }),
    prisma.stockDispatchDiscrepancy.count({
      where: branchOrOrg
        ? branchOrOrg.discrepancy
        : { orgId, status: "PENDING" },
    }),
  ]);

  const lowConfPct = forecastTotal > 0 ? (100 * forecastLow) / forecastTotal : 0;

  const rows: Array<Record<string, unknown>> = [];

  const add = (
    kpiKey: string,
    value: number,
    unit: string,
    trend: "up" | "down" | "flat" | null,
    extra?: Record<string, unknown>
  ) => {
    const def = getKpiDefinition(kpiKey);
    const orgWideOnly =
      opts.branchId != null && ["INBOUND_OPEN_PURCHASE_ORDERS", "REVERSE_ACTIVE_RECALLS"].includes(kpiKey);
    rows.push({
      kpiKey,
      label: def?.label ?? kpiKey,
      value,
      unit,
      trend,
      domain: def?.domain,
      explainTemplate: def?.explainTemplate,
      branchFilter: opts.branchId ?? null,
      ...(orgWideOnly
        ? {
            aggregationNote:
              "Org-wide total; purchase orders and batch recalls are not branch-scoped in this KPI rollup.",
          }
        : {}),
      drilldown: {
        query: drilldownQueryForKpi(kpiKey, orgId, opts.branchId),
        routeHint: def?.routeHint ?? "/owner/inventory/planning",
      },
      ...extra,
    });
  };

  add("FORECAST_LOW_CONFIDENCE_PCT", Math.round(lowConfPct * 10) / 10, "percent", lowConfPct > 25 ? "up" : "flat");
  add("REPLENISHMENT_CRITICAL_OPEN", criticalReplenishment, "count", criticalReplenishment > 0 ? "up" : "flat");
  add("FULFILLMENT_OPEN_STOCK_REQUESTS", openStockRequests, "count", null);
  add("FULFILLMENT_DISPATCH_IN_FLIGHT", dispatchesInFlight, "count", null);
  add("FULFILLMENT_WTO_PIPELINE", wtoPipeline, "count", null);
  add("INBOUND_OPEN_PURCHASE_ORDERS", openPOs, "count", null);
  add("INBOUND_GRN_LAST_7D", grn7d, "count", null);
  add("REVERSE_OPEN_VENDOR_RETURNS", vendorReturnsOpen, "count", null);
  add("REVERSE_ACTIVE_RECALLS", activeRecalls, "count", activeRecalls > 0 ? "up" : "flat");
  add("SLA_DISPATCH_DISCREPANCY_OPEN", pendingDiscrepancies, "count", pendingDiscrepancies > 0 ? "up" : "flat");

  return rows;
}

async function buildCorrelatedAlerts(orgId: number, legacy: Record<string, unknown>) {
  const fromLegacy = Array.isArray(legacy?.alerts) ? legacy.alerts : [];
  const discrepancies = await prisma.stockDispatchDiscrepancy.findMany({
    where: { orgId, status: "PENDING" },
    take: 8,
    orderBy: { createdAt: "desc" },
    include: {
      stockDispatch: { select: { id: true, status: true } },
      variant: { select: { sku: true, title: true } },
    },
  });

  const discAlerts = discrepancies.map((d: any) => ({
    severity: "HIGH" as const,
    code: "INV.DISPATCH_DISCREPANCY",
    title: `Dispatch discrepancy — ${d.variant?.sku ?? "SKU"}`,
    message: `Dispatch #${d.stockDispatchId} — pending resolution`,
    refs: { stockDispatchDiscrepancyId: d.id, stockDispatchId: d.stockDispatchId, variantId: d.variantId },
    routeHint: "/owner/operations/command-center",
  }));

  const merged = [
    ...fromLegacy.map((a: any) => ({
      severity: a.severity === "CRITICAL" ? "CRITICAL" : "MEDIUM",
      code: "AI.REPLENISHMENT_CRITICAL",
      title: a.message || "Replenishment",
      message: a.message,
      refs: { aiReplenishmentSuggestionId: a.id, branchId: a.branchId, variantId: a.variantId },
      routeHint: "/owner/inventory/planning/replenishment",
    })),
    ...discAlerts,
  ].slice(0, 25);

  return merged;
}

export async function getExecutiveKpis(orgId: number, query: { domain?: string; branchId?: number }) {
  const rows = await buildKpiRows(orgId, { branchId: query.branchId });
  let filtered = rows;
  if (query.domain) {
    const defs = KPI_REGISTRY.filter((k) => k.domain === query.domain).map((k) => k.kpiKey);
    filtered = rows.filter((r) => defs.includes(String(r.kpiKey)));
  }
  return {
    generatedAt: new Date().toISOString(),
    orgId,
    branchId: query.branchId ?? null,
    kpis: filtered,
    explain: { engineVersion: ENGINE_VERSION },
  };
}

export async function getDrilldown(
  orgId: number,
  kpiKey: string,
  opts: { branchId?: number; take?: number }
) {
  const take = Math.min(Math.max(opts.take ?? 40, 1), 100);
  const def = getKpiDefinition(kpiKey);
  if (!def) {
    return { success: false, message: "Unknown kpiKey", rows: [] };
  }

  switch (kpiKey) {
    case "REPLENISHMENT_CRITICAL_OPEN": {
      const rows = await prisma.aiReplenishmentSuggestion.findMany({
        where: {
          orgId,
          status: "OPEN",
          severity: "CRITICAL",
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
        },
        take,
        orderBy: { updatedAt: "desc" },
        include: {
          branch: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
        },
      });
      return {
        kpiKey,
        explain: def.explainTemplate,
        columns: ["branch", "sku", "suggestedQty", "onHand", "rop", "reasonCodes"],
        rows: rows.map((r: any) => ({
          id: r.id,
          branch: r.branch?.name,
          sku: r.variant?.sku,
          suggestedQty: r.suggestedQty,
          onHand: r.onHand,
          rop: r.rop,
          reasonCodes: r.reasonCodes,
        })),
      };
    }
    case "FULFILLMENT_OPEN_STOCK_REQUESTS": {
      const rows = await prisma.stockRequest.findMany({
        where: {
          orgId,
          status: { notIn: ["CLOSED", "CANCELLED", "REJECTED"] },
          ...(opts.branchId ? { branchId: opts.branchId } : {}),
        },
        take,
        orderBy: { updatedAt: "desc" },
        include: { branch: { select: { name: true } } },
      });
      return {
        kpiKey,
        explain: def.explainTemplate,
        columns: ["id", "branch", "status", "updatedAt"],
        rows: rows.map((r: any) => ({
          id: r.id,
          branch: r.branch?.name,
          status: r.status,
          updatedAt: r.updatedAt,
        })),
      };
    }
    case "INBOUND_OPEN_PURCHASE_ORDERS": {
      const rows = await prisma.purchaseOrder.findMany({
        where: {
          orgId,
          status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"] },
        },
        take,
        orderBy: { updatedAt: "desc" },
        include: { vendor: { select: { name: true } } },
      });
      return {
        kpiKey,
        explain: def.explainTemplate,
        columns: ["poNumber", "vendor", "status", "grandTotal"],
        rows: rows.map((r: any) => ({
          id: r.id,
          poNumber: r.poNumber,
          vendor: r.vendor?.name,
          status: r.status,
          grandTotal: r.grandTotal,
        })),
      };
    }
    case "SLA_DISPATCH_DISCREPANCY_OPEN": {
      const rows = await prisma.stockDispatchDiscrepancy.findMany({
        where: { orgId, status: "PENDING" },
        take,
        orderBy: { createdAt: "desc" },
        include: {
          variant: { select: { sku: true } },
          stockDispatch: { select: { id: true } },
        },
      });
      return {
        kpiKey,
        explain: def.explainTemplate,
        columns: ["id", "dispatchId", "sku", "status"],
        rows: rows.map((r: any) => ({
          id: r.id,
          dispatchId: r.stockDispatchId,
          sku: r.variant?.sku,
          status: r.status,
        })),
      };
    }
    default:
      return {
        kpiKey,
        explain: def.explainTemplate,
        message: "Drill-down table not yet wired for this KPI — see routeHint for related UI.",
        rows: [],
      };
  }
}
