/**
 * Data repair for stock flow: procurement demand gaps after confirmed allocation shortage,
 * and legacy StockTransfer rows coexisting with active allocation plans.
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../modules/warehouse/warehouseAudit.service";
import { createProcurementDemandLinesFromShortage } from "../modules/procurement_demand/procurementDemand.service";
import { stockTransfersEnterpriseSupersededColumnExists } from "./stockFlowPgCaps.service";

const POST_CONFIRM_PLAN_STATUSES = ["CONFIRMED", "PICKING", "PICKED", "DISPATCHED"] as const;

const LEGACY_PLAN_STATUSES_FOR_CONFLICT = ["CONFIRMED", "PICKING", "PICKED", "DISPATCHED"] as const;

export type ShortageDemandGap = {
  planId: number;
  orgId: number;
  stockRequestId: number;
  shortageQty: number;
  demandLinesForPlan: number;
};

export type LegacyTransferConflict = {
  stockRequestId: number;
  planId: number;
  planStatus: string;
  transferId: number;
  transferStatus: string;
};

export type RepairSummary = {
  shortageGapsFound: number;
  shortageRepaired: number;
  legacyConflictsFound: number;
  legacyCancelledDraft: number;
  legacyMarkedSuperseded: number;
  errors: Array<{ step: string; message: string; ref?: string }>;
};

function orgWhere(orgId: number | null | undefined) {
  return orgId != null && Number.isFinite(orgId) ? { orgId } : {};
}

/**
 * Confirmed+ plans with shortage but no procurement_demand_lines for that plan (idempotent create on repair).
 */
export async function findShortageDemandGaps(options: {
  orgId?: number | null;
  limit?: number;
}): Promise<ShortageDemandGap[]> {
  const limit = Math.min(500, Math.max(20, options.limit ?? 200));
  const plans = await prisma.allocationPlan.findMany({
    where: {
      ...orgWhere(options.orgId ?? null),
      shortageQty: { gt: 0 },
      status: { in: [...POST_CONFIRM_PLAN_STATUSES] },
      stockRequestId: { not: null },
      parentPlanId: null,
      stockRequest: {
        requestIntent: { in: ["INTERNAL_TRANSFER", "PROCUREMENT"] },
      },
    },
    select: {
      id: true,
      orgId: true,
      shortageQty: true,
      stockRequestId: true,
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  const out: ShortageDemandGap[] = [];
  for (const p of plans) {
    if (!p.stockRequestId) continue;
    const demandLinesForPlan = await prisma.procurementDemandLine.count({
      where: { allocationPlanId: p.id, orgId: p.orgId },
    });
    if (demandLinesForPlan === 0) {
      out.push({
        planId: p.id,
        orgId: p.orgId,
        stockRequestId: p.stockRequestId,
        shortageQty: p.shortageQty ?? 0,
        demandLinesForPlan,
      });
    }
  }
  return out;
}

/**
 * Re-run shortage → demand for one plan (same logic as confirmPlan; skips duplicates via unique + counts).
 */
export async function repairProcurementDemandForPlan(
  planId: number,
  orgId: number,
  options: { dryRun: boolean; actorUserId?: number | null }
): Promise<{ created: number; dryRun: boolean }> {
  if (options.dryRun) {
    return { created: 0, dryRun: true };
  }
  return prisma.$transaction(async (tx) => {
    const out = await createProcurementDemandLinesFromShortage(tx, {
      planId,
      orgId,
      actorUserId: options.actorUserId ?? null,
    });
    return { created: out.created, dryRun: false };
  });
}

export async function findLegacyEnterpriseTransferConflicts(options: {
  orgId?: number | null;
  limit?: number;
}): Promise<LegacyTransferConflict[]> {
  const hasSupersededCol = await stockTransfersEnterpriseSupersededColumnExists();
  const limit = Math.min(500, Math.max(20, options.limit ?? 200));
  const plans = await prisma.allocationPlan.findMany({
    where: {
      ...orgWhere(options.orgId ?? null),
      status: { in: [...LEGACY_PLAN_STATUSES_FOR_CONFLICT] },
      stockRequestId: { not: null },
      parentPlanId: null,
    },
    select: { id: true, stockRequestId: true, status: true },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  const out: LegacyTransferConflict[] = [];
  for (const p of plans) {
    if (!p.stockRequestId) continue;
    const transfers = await prisma.stockTransfer.findMany({
      where: {
        stockRequestId: p.stockRequestId,
        status: { not: "CANCELLED" },
        ...(hasSupersededCol ? { enterpriseSupersededAt: null } : {}),
      },
      select: { id: true, status: true },
    });
    for (const t of transfers) {
      out.push({
        stockRequestId: p.stockRequestId,
        planId: p.id,
        planStatus: p.status,
        transferId: t.id,
        transferStatus: t.status,
      });
    }
  }
  return out;
}

/**
 * DRAFT → CANCELLED; non-draft → enterpriseSupersededAt (ledger may already reflect send).
 */
export async function resolveLegacyTransferConflict(
  transferId: number,
  options: { dryRun: boolean; actorUserId?: number | null }
): Promise<{ action: "cancelled_draft" | "marked_superseded" | "skipped" | "dry_run"; orgId: number | null }> {
  const hasSupersededCol = await stockTransfersEnterpriseSupersededColumnExists();
  const t = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    select: {
      id: true,
      status: true,
      stockRequestId: true,
      ...(hasSupersededCol ? { enterpriseSupersededAt: true as const } : {}),
      fromLocation: { select: { warehouseId: true, branch: { select: { orgId: true } } } },
      stockRequest: { select: { orgId: true } },
    },
  });
  if (!t) {
    return { action: "skipped", orgId: null };
  }
  const orgId = t.stockRequest?.orgId ?? t.fromLocation?.branch?.orgId ?? null;
  if (orgId == null) {
    return { action: "skipped", orgId: null };
  }

  if (options.dryRun) {
    return { action: "dry_run", orgId };
  }

  if (t.status === "CANCELLED") {
    return { action: "skipped", orgId };
  }

  const supersededAt = hasSupersededCol ? (t as { enterpriseSupersededAt?: Date | null }).enterpriseSupersededAt : null;
  if (supersededAt != null) {
    return { action: "skipped", orgId };
  }

  if (t.status === "DRAFT") {
    await prisma.stockTransfer.update({
      where: { id: transferId },
      data: { status: "CANCELLED" },
    });
    await logWarehouseAudit({
      orgId,
      warehouseId: t.fromLocation?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "LEGACY_CONFLICT_RESOLVED",
      entityType: "StockTransfer",
      entityId: String(transferId),
      metadata: {
        resolution: "cancelled_draft",
        stockRequestId: t.stockRequestId,
      },
      actorUserId: options.actorUserId ?? null,
    });
    return { action: "cancelled_draft", orgId };
  }

  if (!hasSupersededCol) {
    throw new Error(
      "Cannot mark non-DRAFT legacy transfer as superseded: run `npx prisma migrate deploy` (adds stock_transfers.enterpriseSupersededAt), then re-run repair."
    );
  }

  await prisma.stockTransfer.update({
    where: { id: transferId },
    data: { enterpriseSupersededAt: new Date() },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: t.fromLocation?.warehouseId ?? null,
    category: "OPERATIONS",
    action: "LEGACY_CONFLICT_RESOLVED",
    entityType: "StockTransfer",
    entityId: String(transferId),
    metadata: {
      resolution: "marked_superseded",
      previousStatus: t.status,
      stockRequestId: t.stockRequestId,
    },
    actorUserId: options.actorUserId ?? null,
  });
  return { action: "marked_superseded", orgId };
}

export async function runStockFlowRepair(options: {
  dryRun: boolean;
  orgId?: number | null;
  limit?: number;
  actorUserId?: number | null;
}): Promise<RepairSummary> {
  const summary: RepairSummary = {
    shortageGapsFound: 0,
    shortageRepaired: 0,
    legacyConflictsFound: 0,
    legacyCancelledDraft: 0,
    legacyMarkedSuperseded: 0,
    errors: [],
  };

  const shortageGaps = await findShortageDemandGaps({
    orgId: options.orgId,
    limit: options.limit,
  });
  summary.shortageGapsFound = shortageGaps.length;

  for (const g of shortageGaps) {
    try {
      await repairProcurementDemandForPlan(g.planId, g.orgId, {
        dryRun: options.dryRun,
        actorUserId: options.actorUserId ?? null,
      });
      if (!options.dryRun) {
        const after = await prisma.procurementDemandLine.count({
          where: { allocationPlanId: g.planId, orgId: g.orgId },
        });
        if (after > 0) {
          summary.shortageRepaired += 1;
        } else if (g.shortageQty > 0) {
          summary.errors.push({
            step: "shortage_demand",
            message: "No procurement demand lines after repair — check plan lines vs demand map",
            ref: `planId=${g.planId} sr=${g.stockRequestId}`,
          });
        }
      }
    } catch (e) {
      summary.errors.push({
        step: "shortage_demand",
        message: (e as Error).message,
        ref: `planId=${g.planId}`,
      });
    }
  }

  const conflicts = await findLegacyEnterpriseTransferConflicts({
    orgId: options.orgId,
    limit: options.limit,
  });
  summary.legacyConflictsFound = conflicts.length;

  const seenTransfer = new Set<number>();
  for (const c of conflicts) {
    if (seenTransfer.has(c.transferId)) continue;
    seenTransfer.add(c.transferId);
    try {
      const r = await resolveLegacyTransferConflict(c.transferId, {
        dryRun: options.dryRun,
        actorUserId: options.actorUserId ?? null,
      });
      if (r.action === "cancelled_draft") summary.legacyCancelledDraft += 1;
      if (r.action === "marked_superseded") summary.legacyMarkedSuperseded += 1;
    } catch (e) {
      summary.errors.push({
        step: "legacy_conflict",
        message: (e as Error).message,
        ref: `transferId=${c.transferId}`,
      });
    }
  }

  return summary;
}
