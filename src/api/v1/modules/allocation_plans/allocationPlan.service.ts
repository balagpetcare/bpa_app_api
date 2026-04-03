/**
 * Allocation plans: bridge approved requisitions → FEFO lines → pick lists.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { allocateVariantFifo } from "../inventory/fefoAllocation.service";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import {
  isFulfillmentReservationEnabled,
  releaseAllocationPlanLinesInTx,
  reserveAllocationPlanLinesInTx,
} from "../fulfillment/reservation.service";

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

function demandFromMedicineRequisition(items: Array<{ variantId: number | null; requestedQty: number; approvedQty: number | null }>) {
  const map = new Map<number, number>();
  for (const i of items) {
    if (!i.variantId) continue;
    const q = i.approvedQty ?? i.requestedQty;
    if (q > 0) map.set(i.variantId, q);
  }
  return map;
}

export async function createFromStockRequest(data: {
  orgId: number;
  stockRequestId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
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

  return prisma.allocationPlan.create({
    data: {
      orgId: data.orgId,
      stockRequestId: data.stockRequestId,
      fromLocationId: data.fromLocationId,
      warehouseId: data.warehouseId ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      status: "DRAFT",
    },
    include: {
      stockRequest: { select: { id: true, status: true, branchId: true } },
      fromLocation: { select: { id: true, name: true } },
    },
  });
}

export async function createFromMedicineRequisition(data: {
  orgId: number;
  medicineRequisitionId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
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

  return prisma.allocationPlan.create({
    data: {
      orgId: data.orgId,
      medicineRequisitionId: data.medicineRequisitionId,
      fromLocationId: data.fromLocationId,
      warehouseId: data.warehouseId ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      status: "DRAFT",
    },
    include: {
      medicineRequisition: { select: { id: true, status: true, requisitionNumber: true } },
      fromLocation: { select: { id: true, name: true } },
    },
  });
}

export async function runFefoForPlan(planId: number, orgId: number) {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: {
      stockRequest: { include: { items: true } },
      medicineRequisition: { include: { items: true } },
    },
  });
  if (!plan) throw new Error("Allocation plan not found");
  if (plan.status !== "DRAFT") throw new Error("FEFO can only be (re)run in DRAFT status");

  let demand = new Map<number, number>();
  if (plan.stockRequestId && plan.stockRequest) {
    demand = demandFromStockRequest(plan.stockRequest as any);
  } else if (plan.medicineRequisitionId && plan.medicineRequisition) {
    demand = demandFromMedicineRequisition(plan.medicineRequisition.items);
  } else {
    throw new Error("Allocation plan has no linked requisition");
  }

  if (!demand.size) throw new Error("No line items with variant demand to allocate");

  const fromLocationId = plan.fromLocationId;

  const lineCreates: Array<{
    allocationPlanId: number;
    variantId: number;
    lotId: number;
    locationId: number;
    quantityAllocated: number;
  }> = [];

  for (const [variantId, qty] of demand.entries()) {
    const slices = await allocateVariantFifo(orgId, fromLocationId, variantId, qty);
    for (const s of slices) {
      lineCreates.push({
        allocationPlanId: planId,
        variantId,
        lotId: s.lotId,
        locationId: s.locationId,
        quantityAllocated: s.quantity,
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.allocationPlanLine.deleteMany({ where: { allocationPlanId: planId } });
    if (lineCreates.length) {
      await tx.allocationPlanLine.createMany({ data: lineCreates });
    }

    return tx.allocationPlan.findFirst({
      where: { id: planId },
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
        stockRequest: { select: { id: true, status: true } },
        medicineRequisition: { select: { id: true, status: true, requisitionNumber: true } },
      },
    });
  });
}

export async function confirmPlan(planId: number, orgId: number, actorUserId?: number) {
  const plan = await prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: {
      _count: { select: { lines: true } },
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
  if (plan.status !== "DRAFT") throw new Error("Only DRAFT plans can be confirmed");
  if (!plan._count.lines) throw new Error("Run FEFO allocation before confirming");

  const updated = await prisma.$transaction(async (tx) => {
    if (isFulfillmentReservationEnabled()) {
      await reserveAllocationPlanLinesInTx(tx, {
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

    return tx.allocationPlan.update({
      where: { id: planId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
      },
    });
  });
  const fromLoc = await prisma.inventoryLocation.findUnique({
    where: { id: plan.fromLocationId },
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
      stockRequestId: plan.stockRequestId,
      medicineRequisitionId: plan.medicineRequisitionId,
    },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

export async function cancelPlan(planId: number, orgId: number, reason?: string, actorUserId?: number) {
  const plan = await prisma.allocationPlan.findFirst({
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

  const updated = await prisma.$transaction(async (tx) => {
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
    return tx.allocationPlan.update({
      where: { id: planId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
    });
  });
  const fromLoc = await prisma.inventoryLocation.findUnique({
    where: { id: plan.fromLocationId },
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

export async function getPlanById(planId: number, orgId: number) {
  return prisma.allocationPlan.findFirst({
    where: { id: planId, orgId },
    include: {
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
          location: { select: { id: true, name: true } },
        },
      },
      pickList: {
        include: {
          lines: true,
          dispatch: { select: { id: true, status: true } },
        },
      },
      stockRequest: {
        include: { branch: { select: { id: true, name: true } }, items: true },
      },
      medicineRequisition: { select: { id: true, status: true, requisitionNumber: true } },
      fromLocation: { select: { id: true, name: true } },
    },
  });
}

export async function listPlans(orgId: number, opts?: { status?: string; page?: number; limit?: number }) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: any = { orgId };
  if (opts?.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.allocationPlan.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        stockRequest: { select: { id: true, status: true } },
        medicineRequisition: { select: { id: true, requisitionNumber: true, status: true } },
        fromLocation: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.allocationPlan.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
