/**
 * Allocation plans: approved requisitions → FEFO lines → reservations → pick lists.
 * Enterprise: auto-allocation, partial/shortage, manual lines, reallocate, audit events.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { allocateVariantFifoUpTo } from "../inventory/fefoAllocation.service";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import {
  isFulfillmentReservationEnabled,
  releaseAllocationPlanLinesInTx,
  reserveAllocationPlanLinesInTx,
} from "../fulfillment/reservation.service";
import { getFrozenRecallLotIds, getPendingQcHoldByLot } from "../inventory/stockAvailability.service";

const STOCK_REQUEST_ALLOC_STATUSES = [
  "SUBMITTED",
  "OWNER_REVIEW",
  "APPROVED",
  "FULFILLED_PARTIAL",
  "FULFILLED_FULL",
  "PARTIALLY_DISPATCHED",
  "DISPATCHED",
];

const MED_REQ_ALLOC_STATUSES = [
  "APPROVED",
  "PARTIALLY_APPROVED",
  "READY_TO_DISPATCH",
  "DISPATCHED",
  "IN_TRANSIT",
];

/** States where FEFO / manual line edits are allowed (no reservation yet, no pick in progress). */
const PRE_CONFIRM_STATUSES = ["DRAFT", "ALLOCATED", "PARTIALLY_ALLOCATED", "FAILED"] as const;

function demandFromStockRequest(req: {
  items: Array<{ variantId: number; requestedQty: number }>;
  approvedItems: unknown;
  extraItems: unknown;
}): Map<number, number> {
  const map = new Map<number, number>();
  const approved = (req.approvedItems as Array<{ variantId: number; approvedQty: number }> | null) ?? [];
  if (approved.length) {
    for (const a of approved) {
      if (a.variantId && a.approvedQty > 0) map.set(a.variantId, a.approvedQty);
    }
  } else {
    for (const i of req.items) {
      map.set(i.variantId, i.requestedQty);
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

function demandFromMedicineRequisition(
  items: Array<{ variantId: number | null; requestedQty: number; approvedQty: number | null }>
) {
  const map = new Map<number, number>();
  for (const i of items) {
    if (!i.variantId) continue;
    const q = i.approvedQty ?? i.requestedQty;
    if (q > 0) map.set(i.variantId, q);
  }
  return map;
}

async function logPlanEvent(
  tx: { allocationPlanEvent: { create: (args: unknown) => Promise<unknown> } },
  params: {
    orgId: number;
    allocationPlanId: number;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    metadata?: Record<string, unknown> | null;
    performedByUserId?: number | null;
  }
) {
  return (tx as any).allocationPlanEvent.create({
    data: {
      orgId: params.orgId,
      allocationPlanId: params.allocationPlanId,
      action: params.action,
      fromStatus: params.fromStatus ?? null,
      toStatus: params.toStatus ?? null,
      metadata: params.metadata ?? undefined,
      performedByUserId: params.performedByUserId ?? null,
    },
  });
}

async function loadDemandForPlan(plan: {
  stockRequestId: number | null;
  medicineRequisitionId: number | null;
  stockRequest: { items: unknown; approvedItems: unknown; extraItems: unknown } | null;
  medicineRequisition: { items: unknown } | null;
}): Promise<Map<number, number>> {
  if (plan.stockRequestId && plan.stockRequest) {
    return demandFromStockRequest(plan.stockRequest as any);
  }
  if (plan.medicineRequisitionId && plan.medicineRequisition) {
    return demandFromMedicineRequisition(plan.medicineRequisition.items as any);
  }
  throw new Error("Allocation plan has no linked requisition");
}

function sumDemand(demand: Map<number, number>): number {
  let s = 0;
  for (const q of demand.values()) s += q;
  return s;
}

export async function createFromStockRequest(data: {
  orgId: number;
  stockRequestId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
  /** When true, only create the plan header (no FEFO lines). Default false = auto-allocate. */
  skipAutoAllocation?: boolean;
}) {
  const existing = await prisma.allocationPlan.findUnique({
    where: { stockRequestId: data.stockRequestId },
  });
  if (existing) throw new Error("An allocation plan already exists for this stock request");

  const req = await prisma.stockRequest.findFirst({
    where: { id: data.stockRequestId, orgId: data.orgId },
    include: { items: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (!STOCK_REQUEST_ALLOC_STATUSES.includes(req.status)) {
    throw new Error(`Stock request status ${req.status} does not allow allocation planning`);
  }

  const loc = await prisma.inventoryLocation.findFirst({
    where: { id: data.fromLocationId, branch: { orgId: data.orgId } },
  });
  if (!loc) throw new Error("From location not found in organization");

  if (data.warehouseId != null) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: data.warehouseId, orgId: data.orgId },
    });
    if (!wh) throw new Error("Warehouse not found");
  }

  const plan = await prisma.allocationPlan.create({
    data: {
      orgId: data.orgId,
      stockRequestId: data.stockRequestId,
      fromLocationId: data.fromLocationId,
      warehouseId: data.warehouseId ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      status: "DRAFT",
      allocationMethod: data.skipAutoAllocation ? "MANUAL" : "AUTO_FEFO",
    },
    include: {
      stockRequest: { select: { id: true, status: true, branchId: true } },
      fromLocation: { select: { id: true, name: true } },
    },
  });

  await prisma.allocationPlanEvent.create({
    data: {
      orgId: data.orgId,
      allocationPlanId: plan.id,
      action: "PLAN_CREATED",
      fromStatus: null,
      toStatus: "DRAFT",
      metadata: { skipAutoAllocation: Boolean(data.skipAutoAllocation) },
      performedByUserId: data.createdByUserId ?? null,
    },
  });

  if (data.skipAutoAllocation === true) {
    return getPlanById(plan.id, data.orgId);
  }

  return runFefoForPlan(plan.id, data.orgId, { actorUserId: data.createdByUserId ?? undefined });
}

export async function createFromMedicineRequisition(data: {
  orgId: number;
  medicineRequisitionId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
  skipAutoAllocation?: boolean;
}) {
  const existing = await prisma.allocationPlan.findUnique({
    where: { medicineRequisitionId: data.medicineRequisitionId },
  });
  if (existing) throw new Error("An allocation plan already exists for this medicine requisition");

  const mr = await prisma.medicineRequisition.findFirst({
    where: { id: data.medicineRequisitionId, orgId: data.orgId },
    include: { items: true },
  });
  if (!mr) throw new Error("Medicine requisition not found");
  if (!MED_REQ_ALLOC_STATUSES.includes(mr.status)) {
    throw new Error(`Medicine requisition status ${mr.status} does not allow allocation planning`);
  }

  const loc = await prisma.inventoryLocation.findFirst({
    where: { id: data.fromLocationId, branch: { orgId: data.orgId } },
  });
  if (!loc) throw new Error("From location not found in organization");

  const plan = await prisma.allocationPlan.create({
    data: {
      orgId: data.orgId,
      medicineRequisitionId: data.medicineRequisitionId,
      fromLocationId: data.fromLocationId,
      warehouseId: data.warehouseId ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      status: "DRAFT",
      allocationMethod: data.skipAutoAllocation ? "MANUAL" : "AUTO_FEFO",
    },
    include: {
      medicineRequisition: { select: { id: true, status: true, requisitionNumber: true } },
      fromLocation: { select: { id: true, name: true } },
    },
  });

  await prisma.allocationPlanEvent.create({
    data: {
      orgId: data.orgId,
      allocationPlanId: plan.id,
      action: "PLAN_CREATED",
      fromStatus: null,
      toStatus: "DRAFT",
      metadata: { skipAutoAllocation: Boolean(data.skipAutoAllocation) },
      performedByUserId: data.createdByUserId ?? null,
    },
  });

  if (data.skipAutoAllocation === true) {
    return getPlanById(plan.id, data.orgId);
  }

  return runFefoForPlan(plan.id, data.orgId, { actorUserId: data.createdByUserId ?? undefined });
}

export async function runFefoForPlan(
  planId: number,
  orgId: number,
  opts?: { actorUserId?: number }
) {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: {
      stockRequest: { include: { items: true } },
      medicineRequisition: { include: { items: true } },
    },
  });
  if (!plan) throw new Error("Allocation plan not found");

  const pre = plan.status as (typeof PRE_CONFIRM_STATUSES)[number];
  if (!PRE_CONFIRM_STATUSES.includes(pre)) {
    throw new Error(`Allocation can only be run in ${PRE_CONFIRM_STATUSES.join("/")} status (current: ${plan.status})`);
  }

  const demand = await loadDemandForPlan(plan as any);
  if (!demand.size) throw new Error("No line items with variant demand to allocate");

  const fromLocationId = plan.fromLocationId;
  const totalDemandQty = sumDemand(demand);

  type LineRow = {
    allocationPlanId: number;
    variantId: number;
    lotId: number;
    locationId: number;
    quantityAllocated: number;
    demandQty: number | null;
    quantityShort: number;
    lineStatus: string | null;
    allocationMethod: string | null;
  };

  const lineCreates: LineRow[] = [];

  for (const [variantId, qty] of demand.entries()) {
    const { slices, shortBy } = await allocateVariantFifoUpTo(orgId, fromLocationId, variantId, qty);
    let first = true;
    for (const s of slices) {
      const lineShort = first ? shortBy : 0;
      const lineStatus =
        shortBy > 0 ? (slices.length > 0 ? "PARTIAL" : "SHORT") : slices.length ? "ALLOCATED" : "SHORT";
      lineCreates.push({
        allocationPlanId: planId,
        variantId,
        lotId: s.lotId,
        locationId: s.locationId,
        quantityAllocated: s.quantity,
        demandQty: first ? qty : null,
        quantityShort: lineShort,
        lineStatus: first ? lineStatus : null,
        allocationMethod: "FEFO",
      });
      first = false;
    }
    if (slices.length === 0 && qty > 0) {
      // No stock: no lot rows; shortage reflected at plan level only
    }
  }

  const totalAllocatedQty = lineCreates.reduce((s, l) => s + l.quantityAllocated, 0);
  const shortageQty = Math.max(0, totalDemandQty - totalAllocatedQty);
  const nextStatus =
    totalAllocatedQty === 0 && totalDemandQty > 0
      ? "FAILED"
      : shortageQty > 0
        ? "PARTIALLY_ALLOCATED"
        : "ALLOCATED";

  const prevStatus = plan.status;

  return prisma.$transaction(async (tx) => {
    await tx.allocationPlanLine.deleteMany({ where: { allocationPlanId: planId } });
    for (const row of lineCreates) {
      await tx.allocationPlanLine.create({ data: row });
    }

    await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: nextStatus as any,
        totalDemandQty,
        totalAllocatedQty,
        shortageQty,
        allocationMethod: "AUTO_FEFO",
      },
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "ALLOC_RUN_FEFO",
      fromStatus: prevStatus,
      toStatus: nextStatus,
      metadata: { totalDemandQty, totalAllocatedQty, shortageQty, lineCount: lineCreates.length },
      performedByUserId: opts?.actorUserId ?? null,
    });

    return tx.allocationPlan.findFirst({
      where: { id: planId },
      include: planIncludeDetail(),
    });
  });
}

function planIncludeDetail() {
  return {
    lines: {
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { id: "asc" as const },
    },
    pickList: {
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
            location: { select: { id: true, name: true } },
          },
        },
        dispatch: { select: { id: true, status: true } },
      },
    },
    stockRequest: {
      select: {
        id: true,
        status: true,
        approvedItems: true,
        extraItems: true,
        branch: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
      },
    },
    medicineRequisition: { select: { id: true, status: true, requisitionNumber: true } },
    fromLocation: {
      select: {
        id: true,
        name: true,
        type: true,
        warehouseId: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    },
    events: {
      orderBy: { createdAt: "desc" as const },
      take: 80,
      include: {
        performedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    },
  };
}

export async function confirmPlan(
  planId: number,
  orgId: number,
  actorUserId?: number,
  opts?: { expectedVersion?: number }
) {
  const confirmable = ["DRAFT", "ALLOCATED", "PARTIALLY_ALLOCATED", "FAILED"] as const;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${planId} AND "orgId" = ${orgId} FOR UPDATE`;

    const plan = await tx.allocationPlan.findFirst({
      where: { id: planId, orgId },
      include: {
        lines: {
          where: { quantityAllocated: { gt: 0 } },
          select: {
            variantId: true,
            lotId: true,
            locationId: true,
            quantityAllocated: true,
          },
        },
      },
    });
    if (!plan) throw new Error("Allocation plan not found");

    if (!confirmable.includes(plan.status as (typeof confirmable)[number])) {
      throw new Error(`Only pre-confirmed plans can be confirmed (current: ${plan.status})`);
    }
    if (opts?.expectedVersion != null && plan.version !== opts.expectedVersion) {
      throw new Error("Allocation plan was modified by another process; refresh and retry");
    }
    if (!plan.lines.length) throw new Error("No allocated quantity to confirm; run allocation or add manual lines first");

    const linesToReserve = plan.lines.filter((l) => l.quantityAllocated > 0);
    if (!linesToReserve.length) throw new Error("No positive allocation lines to reserve");

    if (isFulfillmentReservationEnabled()) {
      await reserveAllocationPlanLinesInTx(tx, {
        orgId,
        allocationPlanId: planId,
        fromLocationId: plan.fromLocationId,
        lines: linesToReserve.map((l) => ({
          variantId: l.variantId,
          lotId: l.lotId,
          locationId: l.locationId,
          quantityAllocated: l.quantityAllocated,
        })),
        createdByUserId: actorUserId ?? null,
      });
    }

    const u = await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        version: { increment: 1 },
      },
      include: planIncludeDetail(),
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "ALLOC_CONFIRM",
      fromStatus: plan.status,
      toStatus: "CONFIRMED",
      metadata: { reservedLines: linesToReserve.length },
      performedByUserId: actorUserId ?? null,
    });

    return u;
  });

  const fromLoc = await prisma.inventoryLocation.findUnique({
    where: { id: updated.fromLocationId },
    select: { warehouseId: true },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: fromLoc?.warehouseId ?? null,
    category: "OPERATIONS",
    action: "ALLOC_PLAN_CONFIRM",
    entityType: "AllocationPlan",
    entityId: String(planId),
    metadata: {
      stockRequestId: updated.stockRequestId,
      medicineRequisitionId: updated.medicineRequisitionId,
    },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

export async function cancelPlan(planId: number, orgId: number, reason?: string, actorUserId?: number) {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${planId} AND "orgId" = ${orgId} FOR UPDATE`;

    const plan = await tx.allocationPlan.findFirst({
      where: { id: planId, orgId },
      include: {
        pickList: true,
        lines: {
          select: {
            variantId: true,
            lotId: true,
            locationId: true,
            quantityAllocated: true,
          },
        },
      },
    });
    if (!plan) throw new Error("Allocation plan not found");
    if (["DISPATCHED", "CANCELLED"].includes(plan.status)) {
      throw new Error(`Cannot cancel plan in status ${plan.status}`);
    }
    if (plan.pickList?.stockDispatchId) throw new Error("Plan already linked to dispatch; cancel pick/dispatch first");

    const shouldReleaseReservation =
      isFulfillmentReservationEnabled() && ["CONFIRMED", "PICKING", "PICKED"].includes(plan.status);

    const prevStatus = plan.status;

    if (shouldReleaseReservation && plan.lines.length) {
      await releaseAllocationPlanLinesInTx(tx, {
        orgId,
        allocationPlanId: planId,
        fromLocationId: plan.fromLocationId,
        lines: plan.lines.map((l) => ({
          variantId: l.variantId,
          lotId: l.lotId,
          locationId: l.locationId,
          quantityAllocated: l.quantityAllocated,
        })),
        createdByUserId: actorUserId ?? null,
      });
    }
    if (plan.pickList) {
      await tx.pickListLine.deleteMany({ where: { pickListId: plan.pickList.id } });
      await tx.pickList.delete({ where: { id: plan.pickList.id } });
    }
    await tx.allocationPlanLine.deleteMany({ where: { allocationPlanId: planId } });
    const u = await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
        totalDemandQty: null,
        totalAllocatedQty: null,
        shortageQty: null,
      },
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "PLAN_CANCEL",
      fromStatus: prevStatus,
      toStatus: "CANCELLED",
      metadata: { reason: reason ?? null },
      performedByUserId: actorUserId ?? null,
    });

    return u;
  });

  const fromLoc = await prisma.inventoryLocation.findUnique({
    where: { id: updated.fromLocationId },
    select: { warehouseId: true },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: fromLoc?.warehouseId ?? null,
    category: "OPERATIONS",
    action: "ALLOC_PLAN_CANCEL",
    entityType: "AllocationPlan",
    entityId: String(planId),
    metadata: { reason: reason ?? null },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

/** Add or increment a manual allocation line (lot-backed). Validates effective stock at location. */
export async function addManualAllocationLine(
  planId: number,
  orgId: number,
  data: {
    variantId: number;
    lotId: number;
    locationId: number;
    quantity: number;
  },
  actorUserId?: number
) {
  if (data.quantity <= 0) throw new Error("quantity must be positive");

  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: {
      stockRequest: { include: { items: true } },
      medicineRequisition: { include: { items: true } },
    },
  });
  if (!plan) throw new Error("Allocation plan not found");

  const pre = plan.status as string;
  if (!PRE_CONFIRM_STATUSES.includes(pre as any)) {
    throw new Error(`Manual allocation only allowed before confirm (current: ${plan.status})`);
  }
  if (data.locationId !== plan.fromLocationId) {
    throw new Error("Manual line location must match allocation plan fromLocationId");
  }

  const lot = await prisma.stockLot.findFirst({
    where: { id: data.lotId, orgId, variantId: data.variantId },
    select: { id: true },
  });
  if (!lot) throw new Error("Lot not found for this organization/variant");

  const lb = await prisma.stockLotBalance.findUnique({
    where: { locationId_lotId: { locationId: data.locationId, lotId: data.lotId } },
    include: { lot: { select: { variantId: true } } },
  });
  if (!lb || lb.lot.variantId !== data.variantId) throw new Error("No lot balance at this location for variant/lot");

  const lotIds = [data.lotId];
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, data.locationId),
  ]);
  if (recallFrozen.has(data.lotId)) throw new Error("Lot is under active recall; cannot allocate");
  const qcBlock = qcPending.get(data.lotId) ?? 0;
  const effective = Math.max(0, lb.onHandQty - lb.reservedQty - qcBlock);
  if (data.quantity > effective) {
    throw new Error(`Insufficient effective stock at location (available ${effective}, requested ${data.quantity})`);
  }

  const demand = await loadDemandForPlan(plan as any);
  const totalDemandQty = sumDemand(demand);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.allocationPlanLine.findFirst({
      where: {
        allocationPlanId: planId,
        variantId: data.variantId,
        lotId: data.lotId,
        locationId: data.locationId,
      },
    });

    if (existing) {
      await tx.allocationPlanLine.update({
        where: { id: existing.id },
        data: {
          quantityAllocated: { increment: data.quantity },
          allocationMethod: "MANUAL",
        },
      });
    } else {
      await tx.allocationPlanLine.create({
        data: {
          allocationPlanId: planId,
          variantId: data.variantId,
          lotId: data.lotId,
          locationId: data.locationId,
          quantityAllocated: data.quantity,
          demandQty: null,
          quantityShort: 0,
          lineStatus: "ALLOCATED",
          allocationMethod: "MANUAL",
        },
      });
    }

    const lines = await tx.allocationPlanLine.findMany({
      where: { allocationPlanId: planId },
    });
    const totalAllocatedQty = lines.reduce((s, l) => s + l.quantityAllocated, 0);
    const shortageQty = Math.max(0, totalDemandQty - totalAllocatedQty);
    const nextStatus =
      totalAllocatedQty === 0 && totalDemandQty > 0
        ? "FAILED"
        : shortageQty > 0
          ? "PARTIALLY_ALLOCATED"
          : "ALLOCATED";

    await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: nextStatus as any,
        totalDemandQty,
        totalAllocatedQty,
        shortageQty,
        allocationMethod: plan.allocationMethod === "AUTO_FEFO" ? "HYBRID" : plan.allocationMethod ?? "MANUAL",
      },
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "MANUAL_LINE_UPSERT",
      fromStatus: plan.status,
      toStatus: nextStatus,
      metadata: {
        variantId: data.variantId,
        lotId: data.lotId,
        quantity: data.quantity,
      },
      performedByUserId: actorUserId ?? null,
    });

    return tx.allocationPlan.findFirst({
      where: { id: planId },
      include: planIncludeDetail(),
    });
  });
}

/** Clear allocation lines and re-run FEFO. Releases reservations if plan was CONFIRMED. */
export async function reallocatePlan(planId: number, orgId: number, actorUserId?: number) {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: { pickList: true },
  });
  if (!plan) throw new Error("Allocation plan not found");
  if (plan.pickList) {
    throw new Error("Pick list exists; cancel the pick list or cancel the plan before reallocating");
  }
  if (["DISPATCHED", "CANCELLED"].includes(plan.status)) {
    throw new Error(`Cannot reallocate in status ${plan.status}`);
  }

  const prev = plan.status;

  if (plan.status === "CONFIRMED" && isFulfillmentReservationEnabled()) {
    const full = await prisma.allocationPlan.findFirst({
      where: { id: planId, orgId },
      include: {
        lines: {
          select: {
            variantId: true,
            lotId: true,
            locationId: true,
            quantityAllocated: true,
          },
        },
      },
    });
    await prisma.$transaction(async (tx) => {
      if (full?.lines.length) {
        await releaseAllocationPlanLinesInTx(tx, {
          orgId,
          allocationPlanId: planId,
          fromLocationId: plan.fromLocationId,
          lines: full.lines.map((l) => ({
            variantId: l.variantId,
            lotId: l.lotId,
            locationId: l.locationId,
            quantityAllocated: l.quantityAllocated,
          })),
          createdByUserId: actorUserId ?? null,
        });
      }
      await tx.allocationPlan.update({
        where: { id: planId },
        data: {
          status: "DRAFT",
          confirmedAt: null,
          version: { increment: 1 },
        },
      });
      await logPlanEvent(tx, {
        orgId,
        allocationPlanId: planId,
        action: "REALLOCATE_RELEASE",
        fromStatus: prev,
        toStatus: "DRAFT",
        metadata: {},
        performedByUserId: actorUserId ?? null,
      });
    });
  } else {
    await prisma.allocationPlan.update({
      where: { id: planId },
      data: { status: "DRAFT", confirmedAt: null },
    });
    await prisma.allocationPlanEvent.create({
      data: {
        orgId,
        allocationPlanId: planId,
        action: "REALLOCATE_RESET",
        fromStatus: prev,
        toStatus: "DRAFT",
        performedByUserId: actorUserId ?? null,
      },
    });
  }

  return runFefoForPlan(planId, orgId, { actorUserId });
}

export async function getPlanById(planId: number, orgId: number) {
  return prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: planIncludeDetail(),
  });
}

export async function listPlans(orgId: number, opts?: { status?: string; page?: number; limit?: number }) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = { orgId };
  if (opts?.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.allocationPlan.findMany({
      where: where as any,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        stockRequest: { select: { id: true, status: true } },
        medicineRequisition: { select: { id: true, requisitionNumber: true, status: true } },
        fromLocation: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.allocationPlan.count({ where: where as any }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
