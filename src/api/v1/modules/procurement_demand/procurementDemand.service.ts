/**
 * Procurement demand lines: branch stock-request shortage after warehouse allocation confirm
 * → PO/GRN → optional auto-dispatch (feature-flagged).
 */
import type { Prisma, ProcurementDemandStatus, StockRequestItemBackorderStatus } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { allocateVariantFifoUpTo } from "../inventory/fefoAllocation.service";
import * as dispatchesService from "../dispatches/dispatches.service";

/** Sum demand per variant (multiple SR lines may share the same variant). */
function demandFromStockRequest(req: {
  items: Array<{ variantId: number; requestedQty: number; lineKind: string }>;
  approvedItems: unknown;
  extraItems: unknown;
}): Map<number, number> {
  const map = new Map<number, number>();
  const approved = (req.approvedItems as Array<{ variantId: number; approvedQty: number }> | null) ?? [];
  if (approved.length) {
    for (const a of approved) {
      if (a.variantId && a.approvedQty > 0) {
        map.set(a.variantId, (map.get(a.variantId) ?? 0) + a.approvedQty);
      }
    }
  } else {
    for (const i of req.items) {
      if (i.lineKind === "EXTRA") continue;
      map.set(i.variantId, (map.get(i.variantId) ?? 0) + i.requestedQty);
    }
  }
  const extra = (req.extraItems as Array<{ variantId: number; quantity: number }> | null) ?? [];
  for (const e of extra) {
    if (e.variantId && e.quantity > 0) {
      map.set(e.variantId, (map.get(e.variantId) ?? 0) + e.quantity);
    }
  }
  return map;
}

function effectiveLineNeed(item: {
  requestedQty: number;
  fulfilledQty: number;
  cancelledQty: number;
}): number {
  return Math.max(0, item.requestedQty - item.fulfilledQty - item.cancelledQty);
}

/**
 * After allocation plan confirm (same transaction): create procurement demand rows when FEFO/manual
 * allocation leaves a variant short — for INTERNAL_TRANSFER and PROCUREMENT stock requests.
 * Demand per variant is summed across multiple REQUESTED lines (same variantId).
 */
export async function createProcurementDemandLinesFromShortage(
  tx: Prisma.TransactionClient,
  params: { planId: number; orgId: number; actorUserId?: number | null }
): Promise<{ created: number }> {
  const logPrefix = "[procurementDemand:shortage]";
  const plan = await tx.allocationPlan.findFirst({
    where: { id: params.planId, orgId: params.orgId },
    include: {
      stockRequest: {
        include: {
          items: {
            where: { lineKind: "REQUESTED" },
            orderBy: { id: "asc" },
          },
        },
      },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!plan?.stockRequestId || !plan.stockRequest) {
    console.info(`${logPrefix} skipped planId=${params.planId} reason=no_linked_stock_request`);
    return { created: 0 };
  }
  // Shortage-driven demand applies to branch→DC internal transfers and warehouse PROCUREMENT requisitions.
  if (!["INTERNAL_TRANSFER", "PROCUREMENT"].includes(plan.stockRequest.requestIntent)) {
    console.info(
      `${logPrefix} skipped planId=${params.planId} reason=intent_not_eligible intent=${plan.stockRequest.requestIntent}`
    );
    return { created: 0 };
  }

  const sr = plan.stockRequest;
  const demand = demandFromStockRequest(sr as any);
  const allocatedByVariant = new Map<number, number>();
  for (const l of plan.lines) {
    allocatedByVariant.set(l.variantId, (allocatedByVariant.get(l.variantId) ?? 0) + l.quantityAllocated);
  }

  const firstLineIdByVariant = new Map<number, number>();
  for (const l of plan.lines) {
    if (l.demandQty != null && !firstLineIdByVariant.has(l.variantId)) {
      firstLineIdByVariant.set(l.variantId, l.id);
    }
  }

  const shortageQtyPlan = plan.shortageQty ?? 0;
  if (shortageQtyPlan > 0) {
    console.info(
      `${logPrefix} shortage_detected planId=${params.planId} stockRequestId=${sr.id} shortageQty=${shortageQtyPlan} variantsInDemand=${demand.size} planLines=${plan.lines.length}`
    );
  }

  let created = 0;

  for (const [variantId, variantDemand] of demand) {
    const allocated = allocatedByVariant.get(variantId) ?? 0;
    const variantShort = Math.max(0, variantDemand - allocated);
    if (variantShort <= 0) {
      if (shortageQtyPlan > 0) {
        console.info(
          `${logPrefix} variant_no_shortfall planId=${params.planId} variantId=${variantId} demand=${variantDemand} allocated=${allocated}`
        );
      }
      continue;
    }

    console.info(
      `${logPrefix} shortage_detected_variant planId=${params.planId} variantId=${variantId} variantShort=${variantShort} demand=${variantDemand} allocated=${allocated}`
    );

    const items = sr.items.filter((i) => i.variantId === variantId);
    if (!items.length) {
      console.info(`${logPrefix} skipped variantId=${variantId} reason=no_matching_request_lines`);
      continue;
    }

    const weights = items.map((i) => effectiveLineNeed(i));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight <= 0) {
      console.info(
        `${logPrefix} skipped variantId=${variantId} reason=no_effective_line_need (lines may be fully cancelled/fulfilled)`
      );
      continue;
    }

    let remaining = variantShort;
    const allocLineId = firstLineIdByVariant.get(variantId) ?? null;
    const eligibleIdx = items.map((_, idx) => idx).filter((idx) => weights[idx] > 0);

    for (let j = 0; j < eligibleIdx.length; j++) {
      const idx = eligibleIdx[j];
      const item = items[idx];
      const w = weights[idx];
      if (remaining <= 0) break;

      const isLast = j === eligibleIdx.length - 1;
      const portion = isLast ? Math.min(w, remaining) : Math.min(w, Math.floor((variantShort * w) / totalWeight), remaining);
      const itemShort = Math.max(0, Math.min(portion, w, remaining));
      if (itemShort <= 0) continue;
      remaining -= itemShort;

      const existingCount = await tx.procurementDemandLine.count({
        where: {
          stockRequestItemId: item.id,
          allocationPlanId: plan.id,
        },
      });
      if (existingCount > 0) {
        console.info(
          `${logPrefix} skipped_duplicate planId=${params.planId} stockRequestItemId=${item.id} allocationPlanId=${plan.id}`
        );
        continue;
      }

      await tx.procurementDemandLine.create({
        data: {
          orgId: params.orgId,
          stockRequestId: sr.id,
          stockRequestItemId: item.id,
          allocationPlanId: plan.id,
          allocationPlanLineId: allocLineId,
          variantId,
          demandQty: itemShort,
          status: "PENDING",
        },
      });

      await tx.stockRequestItem.update({
        where: { id: item.id },
        data: { backorderStatus: "PENDING_PROCUREMENT" },
      });

      created += 1;
      console.info(
        `${logPrefix} demand_created planId=${params.planId} stockRequestItemId=${item.id} variantId=${variantId} demandQty=${itemShort}`
      );
    }
  }

  /** Plan-level shortage but no lines: e.g. all variants had zero FEFO rows — use quantityShort on first line per variant. */
  if (shortageQtyPlan > 0 && created === 0) {
    const shortByVariant = new Map<number, number>();
    for (const l of plan.lines) {
      const q = Number(l.quantityShort) || 0;
      if (q <= 0) continue;
      if (!shortByVariant.has(l.variantId)) shortByVariant.set(l.variantId, q);
    }
    for (const [variantId, qtyShort] of shortByVariant) {
      const items = sr.items.filter((i) => i.variantId === variantId);
      const weights = items.map((i) => effectiveLineNeed(i));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      if (totalWeight <= 0 || !items.length) continue;
      let rem = qtyShort;
      const allocLineId = firstLineIdByVariant.get(variantId) ?? null;
      const eligibleIdx = items.map((_, idx) => idx).filter((idx) => weights[idx] > 0);
      for (let j = 0; j < eligibleIdx.length; j++) {
        const idx = eligibleIdx[j];
        const item = items[idx];
        const w = weights[idx];
        if (rem <= 0) break;
        const isLast = j === eligibleIdx.length - 1;
        const portion = isLast ? Math.min(w, rem) : Math.min(w, Math.floor((qtyShort * w) / totalWeight), rem);
        const itemShort = Math.max(0, Math.min(portion, w, rem));
        if (itemShort <= 0) continue;
        rem -= itemShort;

        const existingCount = await tx.procurementDemandLine.count({
          where: { stockRequestItemId: item.id, allocationPlanId: plan.id },
        });
        if (existingCount > 0) continue;

        await tx.procurementDemandLine.create({
          data: {
            orgId: params.orgId,
            stockRequestId: sr.id,
            stockRequestItemId: item.id,
            allocationPlanId: plan.id,
            allocationPlanLineId: allocLineId,
            variantId,
            demandQty: itemShort,
            status: "PENDING",
          },
        });
        await tx.stockRequestItem.update({
          where: { id: item.id },
          data: { backorderStatus: "PENDING_PROCUREMENT" },
        });
        created += 1;
        console.info(
          `${logPrefix} demand_created_fallback_quantityShort planId=${params.planId} stockRequestItemId=${item.id} variantId=${variantId} demandQty=${itemShort}`
        );
      }
    }
    if (shortageQtyPlan > 0 && created === 0) {
      console.warn(
        `${logPrefix} plan_shortage_unresolved planId=${params.planId} stockRequestId=${sr.id} shortageQty=${shortageQtyPlan} — no demand rows created; check demand map vs allocation lines`
      );
    }
  }

  if (created > 0) {
    await logWarehouseAudit({
      orgId: params.orgId,
      warehouseId: plan.warehouseId ?? null,
      category: "OPERATIONS",
      action: "PROCUREMENT_DEMAND_CREATED",
      entityType: "AllocationPlan",
      entityId: String(params.planId),
      metadata: { linesCreated: created, stockRequestId: sr.id },
      actorUserId: params.actorUserId ?? null,
    });
  }

  return { created };
}

export async function listProcurementDemands(opts: {
  orgId: number;
  status?: ProcurementDemandStatus;
  stockRequestId?: number;
  page?: number;
  limit?: number;
}) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 30, 100);
  const where: Prisma.ProcurementDemandLineWhereInput = { orgId: opts.orgId };
  if (opts.status) where.status = opts.status;
  if (opts.stockRequestId) where.stockRequestId = opts.stockRequestId;

  const [items, total] = await Promise.all([
    prisma.procurementDemandLine.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        stockRequest: { select: { id: true, status: true, branchId: true, branch: { select: { name: true } } } },
        stockRequestItem: { select: { id: true, requestedQty: true, fulfilledQty: true, backorderStatus: true } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        purchaseOrderLine: { select: { id: true, orderedQty: true, receivedQty: true } },
        fulfillmentDispatch: { select: { id: true, status: true } },
      },
    }),
    prisma.procurementDemandLine.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getProcurementDemandById(id: number, orgId: number) {
  return prisma.procurementDemandLine.findFirst({
    where: { id, orgId },
    include: {
      variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
      stockRequest: {
        select: {
          id: true,
          status: true,
          branchId: true,
          branch: { select: { name: true } },
        },
      },
      stockRequestItem: true,
      allocationPlan: { select: { id: true, status: true, fromLocationId: true } },
      purchaseOrder: true,
      purchaseOrderLine: true,
      fulfillmentDispatch: true,
    },
  });
}

export async function linkDemandToPurchaseOrderLine(params: {
  demandId: number;
  orgId: number;
  purchaseOrderLineId: number;
  actorUserId?: number | null;
}) {
  const line = await prisma.purchaseOrderLine.findFirst({
    where: { id: params.purchaseOrderLineId, purchaseOrder: { orgId: params.orgId } },
    include: { purchaseOrder: true, variant: true },
  });
  if (!line) throw new Error("Purchase order line not found");

  const demand = await prisma.procurementDemandLine.findFirst({
    where: { id: params.demandId, orgId: params.orgId },
  });
  if (!demand) throw new Error("Procurement demand not found");
  if (demand.variantId !== line.variantId) throw new Error("PO line variant does not match demand variant");
  if (demand.status === "CANCELLED" || demand.status === "DISPATCHED") {
    throw new Error(`Cannot link demand in status ${demand.status}`);
  }

  const updated = await prisma.procurementDemandLine.update({
    where: { id: demand.id },
    data: {
      purchaseOrderId: line.purchaseOrderId,
      purchaseOrderLineId: line.id,
      status: "PO_LINKED",
    },
  });

  await prisma.stockRequestItem.update({
    where: { id: demand.stockRequestItemId },
    data: { backorderStatus: "PROCUREMENT_LINKED" },
  });

  await logWarehouseAudit({
    orgId: params.orgId,
    warehouseId: line.purchaseOrder.warehouseId ?? null,
    category: "OPERATIONS",
    action: "PROCUREMENT_DEMAND_PO_LINKED",
    entityType: "ProcurementDemandLine",
    entityId: String(demand.id),
    metadata: { purchaseOrderId: line.purchaseOrderId, purchaseOrderLineId: line.id },
    actorUserId: params.actorUserId ?? null,
  });

  return updated;
}

export async function cancelProcurementDemand(params: {
  demandId: number;
  orgId: number;
  reason?: string;
  actorUserId?: number | null;
}) {
  const demand = await prisma.procurementDemandLine.findFirst({
    where: { id: params.demandId, orgId: params.orgId },
  });
  if (!demand) throw new Error("Procurement demand not found");
  if (demand.status === "DISPATCHED") throw new Error("Cannot cancel a dispatched demand");

  const updated = await prisma.procurementDemandLine.update({
    where: { id: demand.id },
    data: { status: "CANCELLED" },
  });

  const open = await prisma.procurementDemandLine.count({
    where: {
      stockRequestItemId: demand.stockRequestItemId,
      status: { notIn: ["CANCELLED", "DISPATCHED"] },
    },
  });
  if (open === 0) {
    await prisma.stockRequestItem.update({
      where: { id: demand.stockRequestItemId },
      data: { backorderStatus: "NONE" },
    });
  }

  await logWarehouseAudit({
    orgId: params.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "PROCUREMENT_DEMAND_CANCELLED",
    entityType: "ProcurementDemandLine",
    entityId: String(demand.id),
    metadata: { reason: params.reason ?? null },
    actorUserId: params.actorUserId ?? null,
  });

  return updated;
}

/**
 * Sync demand fulfilled quantities from PO line received amounts after GRN receive (idempotent).
 */
export async function syncProcurementDemandsFromPurchaseOrderLines(
  tx: Prisma.TransactionClient,
  params: { orgId: number; purchaseOrderId: number }
): Promise<{ updatedIds: number[] }> {
  const polLines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId: params.purchaseOrderId },
    orderBy: { id: "asc" },
    select: { id: true, receivedQty: true },
  });
  const updatedIds: number[] = [];
  const touchedItemIds = new Set<number>();

  for (const pol of polLines) {
    const demands = await tx.procurementDemandLine.findMany({
      where: {
        orgId: params.orgId,
        purchaseOrderLineId: pol.id,
        status: { notIn: ["CANCELLED", "DISPATCHED"] },
      },
      orderBy: { id: "asc" },
    });
    if (!demands.length) continue;

    let budget = pol.receivedQty;
    for (const d of demands) {
      const take = Math.min(d.demandQty, Math.max(0, budget));
      budget -= take;

      const nextStatus: ProcurementDemandStatus =
        take >= d.demandQty ? "FULFILLED" : take > 0 ? "PARTIALLY_RECEIVED" : "PO_LINKED";

      if (take !== d.fulfilledQty || nextStatus !== d.status) {
        await tx.procurementDemandLine.update({
          where: { id: d.id },
          data: { fulfilledQty: take, status: nextStatus },
        });
        updatedIds.push(d.id);
      }
      touchedItemIds.add(d.stockRequestItemId);
    }
  }

  for (const itemId of touchedItemIds) {
    const lines = await tx.procurementDemandLine.findMany({
      where: { stockRequestItemId: itemId, status: { notIn: ["CANCELLED"] } },
      select: { status: true, fulfillmentDispatchId: true },
    });
    let backorder: StockRequestItemBackorderStatus = "NONE";
    if (lines.length) {
      if (lines.some((l) => l.status === "FULFILLED" && l.fulfillmentDispatchId == null)) {
        backorder = "READY_TO_FULFILL";
      } else if (lines.some((l) => l.status === "PENDING")) {
        backorder = "PENDING_PROCUREMENT";
      } else if (lines.some((l) => l.status === "PO_LINKED" || l.status === "PARTIALLY_RECEIVED")) {
        backorder = "PROCUREMENT_LINKED";
      } else if (lines.every((l) => l.status === "DISPATCHED" || l.fulfillmentDispatchId != null)) {
        backorder = "NONE";
      } else {
        backorder = "PROCUREMENT_LINKED";
      }
    }

    await tx.stockRequestItem.update({
      where: { id: itemId },
      data: { backorderStatus: backorder },
    });
  }

  return { updatedIds };
}

function autoDispatchEnabled(): boolean {
  const v = String(process.env.AUTO_PROCUREMENT_DEMAND_DISPATCH ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * After GRN receive (post-commit): optionally auto-create/send dispatch for FULFILLED demands.
 */
export async function tryAutoDispatchFulfilledDemandsForGrn(grnId: number, orgId: number): Promise<void> {
  if (!autoDispatchEnabled()) return;

  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: { purchaseOrderId: true, locationId: true },
  });
  if (!grn?.purchaseOrderId || !grn.locationId) return;

  const demands = await prisma.procurementDemandLine.findMany({
    where: {
      orgId,
      purchaseOrderId: grn.purchaseOrderId,
      status: "FULFILLED",
      fulfillmentDispatchId: null,
    },
    include: {
      stockRequest: { select: { id: true, branchId: true, status: true } },
    },
  });
  if (!demands.length) return;

  const fromLocationId = grn.locationId;

  const bySr = new Map<number, typeof demands>();
  for (const d of demands) {
    const list = bySr.get(d.stockRequestId) ?? [];
    list.push(d);
    bySr.set(d.stockRequestId, list);
  }

  for (const [stockRequestId, group] of bySr) {
    const lastDispatch = await prisma.stockDispatch.findFirst({
      where: { stockRequestId, orgId },
      orderBy: { id: "desc" },
      select: { toLocationId: true },
    });
    if (!lastDispatch) continue;

    const merged = new Map<string, { variantId: number; lotId: number; quantity: number }>();
    let shortfall = false;
    for (const d of group) {
      const { slices } = await allocateVariantFifoUpTo(orgId, fromLocationId, d.variantId, d.demandQty);
      let left = d.demandQty;
      for (const s of slices) {
        if (left <= 0) break;
        const q = Math.min(left, s.quantity);
        const k = `${d.variantId}:${s.lotId}`;
        const cur = merged.get(k);
        if (cur) cur.quantity += q;
        else merged.set(k, { variantId: d.variantId, lotId: s.lotId, quantity: q });
        left -= q;
      }
      if (left > 0) {
        shortfall = true;
        break;
      }
    }
    if (shortfall || merged.size === 0) continue;

    const items = Array.from(merged.values());

    const dispatch = await dispatchesService.createDispatch({
      orgId,
      stockRequestId,
      fromLocationId,
      toLocationId: lastDispatch.toLocationId,
      items,
      createdByUserId: undefined,
    });

    await dispatchesService.sendDispatch(dispatch.id);

    for (const d of group) {
      await prisma.procurementDemandLine.update({
        where: { id: d.id },
        data: { status: "DISPATCHED", fulfillmentDispatchId: dispatch.id },
      });
    }

    await logWarehouseAudit({
      orgId,
      warehouseId: null,
      category: "OPERATIONS",
      action: "PROCUREMENT_DEMAND_AUTO_DISPATCH",
      entityType: "Grn",
      entityId: String(grnId),
      metadata: { stockRequestId, dispatchId: dispatch.id, demandIds: group.map((g) => g.id) },
      actorUserId: null,
    });
  }
}

/**
 * Idempotent recovery / manual trigger: re-sync demand `fulfilledQty` from PO line `receivedQty`, then optional auto-dispatch.
 * Used by POST `/procurement-demand/process-grn/:grnId` after GRN receive or if post-receive work failed.
 */
export async function reprocessProcurementDemandAfterGrn(
  grnId: number,
  orgId: number
): Promise<{ syncedPurchaseOrder: boolean }> {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: { purchaseOrderId: true },
  });
  if (!grn) {
    throw new Error("GRN not found");
  }
  if (!grn.purchaseOrderId) {
    await tryAutoDispatchFulfilledDemandsForGrn(grnId, orgId);
    return { syncedPurchaseOrder: false };
  }
  await prisma.$transaction(async (tx) => {
    await syncProcurementDemandsFromPurchaseOrderLines(tx, {
      orgId,
      purchaseOrderId: grn.purchaseOrderId,
    });
  });
  await tryAutoDispatchFulfilledDemandsForGrn(grnId, orgId);
  return { syncedPurchaseOrder: true };
}
