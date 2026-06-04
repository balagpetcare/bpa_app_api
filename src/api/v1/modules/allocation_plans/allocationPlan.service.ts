/**
 * Allocation plans: approved requisitions → FEFO lines → reservations → pick lists.
 * Enterprise: auto-allocation, partial/shortage, manual lines, reallocate, audit events.
 * Multi-source: feature-gated multi-warehouse FEFO allocation (MULTI_SOURCE_ALLOCATION_ENABLED).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { allocateVariantFifoUpTo } from "../inventory/fefoAllocation.service";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import {
  isFulfillmentReservationEnabled,
  lockStockLotBalancesForAllocation,
  releaseAllocationPlanLinesInTx,
  reserveAllocationPlanLinesInTx,
} from "../fulfillment/reservation.service";
import { getFrozenRecallLotIds, getPendingQcHoldByLot } from "../inventory/stockAvailability.service";
import { canTransitionTo, type StockRequestStatus } from "../../services/stockRequestStatus.service";
import {
  isMultiSourceEnabled,
  runMultiSourceAllocation,
} from "../../services/multiSourceAllocator.service";
import {
  createBackordersFromPlanShortage,
  syncBackordersAfterSupplementaryPlanConfirm,
} from "../backorders/backorder.service";
import { MultiWarehouseFulfillmentError, MW_CODES } from "../../services/multiWarehouseFulfillment.errors";
import { mwLogError, mwLogInfo } from "../../services/multiWarehouseFulfillment.logger";

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
  items: Array<{ variantId: number; requestedQty: number; lineKind?: string | null }>;
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
  /** MULTI_SOURCE enables cross-warehouse allocation (feature-gated). */
  allocationScope?: "SINGLE_SOURCE" | "MULTI_SOURCE";
  /** Explicit source location whitelist for multi-source (optional). */
  sourceLocationIds?: number[];
  /** When true, create backorder records for shortages on confirm. */
  autoBackorder?: boolean;
}) {
  const existing = await prisma.allocationPlan.findFirst({
    where: { stockRequestId: data.stockRequestId, orgId: data.orgId, parentPlanId: null },
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

  if (data.allocationScope === "MULTI_SOURCE" && !isMultiSourceEnabled()) {
    throw new MultiWarehouseFulfillmentError(MW_CODES.MULTI_SOURCE_DISABLED, { httpStatus: 403 });
  }

  const useMultiSource =
    data.allocationScope === "MULTI_SOURCE" && isMultiSourceEnabled();

  const plan = await prisma.allocationPlan.create({
    data: {
      orgId: data.orgId,
      stockRequestId: data.stockRequestId,
      fromLocationId: data.fromLocationId,
      warehouseId: data.warehouseId ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      status: "DRAFT",
      allocationMethod: data.skipAutoAllocation
        ? "MANUAL"
        : useMultiSource
          ? "AUTO_FEFO_MULTI"
          : "AUTO_FEFO",
      allocationScope: useMultiSource ? "MULTI_SOURCE" : "SINGLE_SOURCE",
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
      metadata: {
        skipAutoAllocation: Boolean(data.skipAutoAllocation),
        allocationScope: useMultiSource ? "MULTI_SOURCE" : "SINGLE_SOURCE",
        autoBackorder: Boolean(data.autoBackorder),
      },
      performedByUserId: data.createdByUserId ?? null,
    },
  });

  if (data.skipAutoAllocation === true) {
    return getPlanById(plan.id, data.orgId);
  }

  if (useMultiSource) {
    return runMultiSourceFefoForPlan(plan.id, data.orgId, {
      actorUserId: data.createdByUserId ?? undefined,
      sourceLocationIds: data.sourceLocationIds,
    });
  }

  return runFefoForPlan(plan.id, data.orgId, { actorUserId: data.createdByUserId ?? undefined });
}

/**
 * Multi-source FEFO allocation: allocates across multiple warehouses in priority order.
 * Creates AllocationPlanLine rows with varying locationId and AllocationSourceSummary rows.
 */
export async function runMultiSourceFefoForPlan(
  planId: number,
  orgId: number,
  opts?: { actorUserId?: number; sourceLocationIds?: number[] },
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

  let result;
  try {
    result = await runMultiSourceAllocation(orgId, demand, {
      preferredLocationId: plan.fromLocationId,
      sourceLocationIds: opts?.sourceLocationIds,
    });
  } catch (e) {
    mwLogError("runMultiSourceFefoForPlan_alloc_failed", e, { planId, orgId });
    throw e;
  }

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
    sourceWarehouseId: number | null;
  };

  const lineCreates: LineRow[] = [];
  const variantFirstSeen = new Set<number>();

  for (const line of result.lines) {
    const isFirst = !variantFirstSeen.has(line.variantId);
    if (isFirst) variantFirstSeen.add(line.variantId);

    const shortage = result.shortages.find((s) => s.variantId === line.variantId);
    const variantDemand = demand.get(line.variantId) ?? 0;

    lineCreates.push({
      allocationPlanId: planId,
      variantId: line.variantId,
      lotId: line.lotId,
      locationId: line.locationId,
      quantityAllocated: line.quantityAllocated,
      demandQty: isFirst ? variantDemand : null,
      quantityShort: isFirst ? (shortage?.shortageQty ?? 0) : 0,
      lineStatus: isFirst
        ? shortage
          ? "PARTIAL"
          : "ALLOCATED"
        : null,
      allocationMethod: "FEFO",
      sourceWarehouseId: line.warehouseId,
    });
  }

  const nextStatus =
    result.totalAllocatedQty === 0 && result.totalDemandQty > 0
      ? "FAILED"
      : result.totalShortageQty > 0
        ? "PARTIALLY_ALLOCATED"
        : "ALLOCATED";

  const prevStatus = plan.status;

  return prisma.$transaction(async (tx) => {
    await tx.allocationPlanLine.deleteMany({ where: { allocationPlanId: planId } });
    await tx.allocationSourceSummary.deleteMany({ where: { allocationPlanId: planId } });

    for (const row of lineCreates) {
      await tx.allocationPlanLine.create({ data: row });
    }

    // Build source summaries grouped by locationId
    const sourceGroups = new Map<number, { warehouseId: number | null; totalQty: number; lineCount: number }>();
    for (const line of lineCreates) {
      const existing = sourceGroups.get(line.locationId);
      if (existing) {
        existing.totalQty += line.quantityAllocated;
        existing.lineCount++;
      } else {
        sourceGroups.set(line.locationId, {
          warehouseId: line.sourceWarehouseId,
          totalQty: line.quantityAllocated,
          lineCount: 1,
        });
      }
    }

    for (const [locationId, group] of sourceGroups.entries()) {
      await tx.allocationSourceSummary.create({
        data: {
          orgId,
          allocationPlanId: planId,
          locationId,
          warehouseId: group.warehouseId,
          totalAllocatedQty: group.totalQty,
          totalLineCount: group.lineCount,
          sourceStatus: "PENDING",
        },
      });
    }

    await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: nextStatus as any,
        totalDemandQty: result.totalDemandQty,
        totalAllocatedQty: result.totalAllocatedQty,
        shortageQty: result.totalShortageQty,
        allocationMethod: "AUTO_FEFO_MULTI",
        sourceCount: sourceGroups.size,
      },
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "MULTI_SOURCE_ALLOC_RUN",
      fromStatus: prevStatus,
      toStatus: nextStatus,
      metadata: {
        totalDemandQty: result.totalDemandQty,
        totalAllocatedQty: result.totalAllocatedQty,
        shortageQty: result.totalShortageQty,
        sourceCount: sourceGroups.size,
        lineCount: lineCreates.length,
      },
      performedByUserId: opts?.actorUserId ?? null,
    });

    return tx.allocationPlan.findFirst({
      where: { id: planId },
      include: planIncludeDetailMultiSource(),
    });
  });
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

/**
 * Run FEFO for a plan using an explicit demand map (e.g. supplementary plan = sum of backorder remainingQty per variant).
 */
export async function runFefoForPlanWithDemand(
  planId: number,
  orgId: number,
  demand: Map<number, number>,
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

  if (!demand.size) throw new Error("No variant demand to allocate");

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

  const demand = await loadDemandForPlan(plan as any);
  if (!demand.size) throw new Error("No line items with variant demand to allocate");
  return runFefoForPlanWithDemand(planId, orgId, demand, opts);
}

/**
 * Create a child allocation plan chained from a parent plan to cover open backorder remaining quantities,
 * then run FEFO against that demand only. One supplementary plan per parent (schema: parentPlanId unique).
 */
export async function createSupplementaryPlanFromBackorders(params: {
  parentPlanId: number;
  orgId: number;
  fromLocationId: number;
  createdByUserId?: number | null;
}) {
  const child = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${params.parentPlanId} AND "orgId" = ${params.orgId} FOR UPDATE`;

    const parent = await tx.allocationPlan.findFirst({
      where: { id: params.parentPlanId, orgId: params.orgId },
      include: { supplementaryPlan: { select: { id: true } } },
    });
    if (!parent) throw new Error("Parent allocation plan not found");
    if (parent.supplementaryPlan) {
      throw new Error("A supplementary allocation plan already exists for this parent plan");
    }
    if (!parent.stockRequestId) throw new Error("Parent plan has no stock request");

    const backorders = await tx.backorder.findMany({
      where: {
        allocationPlanId: params.parentPlanId,
        remainingQty: { gt: 0 },
        status: { notIn: ["CANCELLED", "CLOSED"] },
      },
    });
    if (!backorders.length) throw new Error("No open backorders with remaining quantity for this plan");

    const demand = new Map<number, number>();
    for (const b of backorders) {
      demand.set(b.variantId, (demand.get(b.variantId) ?? 0) + b.remainingQty);
    }

    const created = await tx.allocationPlan.create({
      data: {
        orgId: params.orgId,
        stockRequestId: parent.stockRequestId,
        fromLocationId: params.fromLocationId,
        warehouseId: parent.warehouseId ?? undefined,
        parentPlanId: params.parentPlanId,
        createdByUserId: params.createdByUserId ?? undefined,
        status: "DRAFT",
        allocationMethod: "AUTO_FEFO",
        allocationScope: parent.allocationScope ?? "SINGLE_SOURCE",
      },
    });

    await tx.backorder.updateMany({
      where: { id: { in: backorders.map((b) => b.id) } },
      data: { supplementaryPlanId: created.id, status: "LINKED" as any },
    });

    await logPlanEvent(tx, {
      orgId: params.orgId,
      allocationPlanId: created.id,
      action: "SUPPLEMENTARY_PLAN_CREATED",
      fromStatus: null,
      toStatus: "DRAFT",
      metadata: {
        parentPlanId: params.parentPlanId,
        backorderIds: backorders.map((b) => b.id),
      },
      performedByUserId: params.createdByUserId ?? null,
    });

    return { createdId: created.id, demand };
  });

  return runFefoForPlanWithDemand(child.createdId, params.orgId, child.demand, {
    actorUserId: params.createdByUserId ?? undefined,
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
    sourceSummaries: {
      include: {
        location: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { id: "asc" as const },
    },
    pickLists: {
      orderBy: { id: "desc" as const },
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

function planIncludeDetailMultiSource() {
  const base = planIncludeDetail();
  return {
    ...base,
    sourceSummaries: {
      include: {
        location: { select: { id: true, name: true, type: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        pickList: { select: { id: true, status: true } },
        dispatch: { select: { id: true, status: true } },
      },
      orderBy: { id: "asc" as const },
    },
    backorders: {
      include: {
        variant: { select: { id: true, sku: true, title: true } },
      },
      orderBy: { id: "asc" as const },
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
      select: {
        id: true,
        orgId: true,
        status: true,
        version: true,
        fromLocationId: true,
        stockRequestId: true,
        parentPlanId: true,
        shortageQty: true,
        allocationScope: true,
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

    const isMulti = (plan as any).allocationScope === "MULTI_SOURCE";

    if (isFulfillmentReservationEnabled()) {
      await lockStockLotBalancesForAllocation(
        tx,
        linesToReserve.map((l) => ({ locationId: l.locationId, lotId: l.lotId })),
      );
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
        multiSource: isMulti,
      });
    }

    // Update source summaries to CONFIRMED for multi-source plans
    if (isMulti) {
      await tx.allocationSourceSummary.updateMany({
        where: {
          allocationPlanId: planId,
          sourceStatus: "PENDING",
          totalAllocatedQty: { gt: 0 },
        },
        data: { sourceStatus: "CONFIRMED", confirmedAt: new Date() },
      });
    }

    const u = await tx.allocationPlan.update({
      where: { id: planId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        version: { increment: 1 },
      },
      include: isMulti ? planIncludeDetailMultiSource() : planIncludeDetail(),
    });

    await logPlanEvent(tx, {
      orgId,
      allocationPlanId: planId,
      action: "ALLOC_CONFIRM",
      fromStatus: plan.status,
      toStatus: "CONFIRMED",
      metadata: {
        reservedLines: linesToReserve.length,
        multiSource: isMulti,
      },
      performedByUserId: actorUserId ?? null,
    });

    // Shortage → procurement_demand_lines (idempotent; same transaction as CONFIRMED)
    const procurementDemandSvc = require("../procurement_demand/procurementDemand.service");
    await procurementDemandSvc.createProcurementDemandLinesFromShortage(tx, {
      planId,
      orgId,
      actorUserId: actorUserId ?? null,
    });

    // Create backorder records for shortages
    if ((u as any).shortageQty > 0 && (u as any).stockRequestId) {
      const shortageLines = await tx.allocationPlanLine.findMany({
        where: { allocationPlanId: planId, quantityShort: { gt: 0 } },
        select: { variantId: true, quantityShort: true },
      });

      if (shortageLines.length > 0) {
        const srItems = await tx.stockRequestItem.findMany({
          where: { stockRequestId: (u as any).stockRequestId },
          select: { id: true, variantId: true },
        });
        const variantToItemId = new Map(srItems.map((i: any) => [i.variantId, i.id]));

        await createBackordersFromPlanShortage(tx, {
          orgId,
          allocationPlanId: planId,
          stockRequestId: (u as any).stockRequestId,
          shortages: shortageLines.map((l: any) => ({
            variantId: l.variantId,
            shortageQty: l.quantityShort,
            stockRequestItemId: variantToItemId.get(l.variantId) ?? null,
          })),
          priority: 0,
        });
      }
    }

    if (u.stockRequestId) {
      const sr = await tx.stockRequest.findUnique({
        where: { id: u.stockRequestId },
        include: {
          dispatches: { select: { status: true } },
          items: {
            select: {
              id: true,
              variantId: true,
              requestedQty: true,
              fulfilledQty: true,
              cancelledQty: true,
              lineKind: true,
              backorderStatus: true,
            },
          },
        },
      });
      if (sr && !["CLOSED", "CANCELLED"].includes(sr.status)) {
        const from = sr.status as StockRequestStatus;
        const gate = canTransitionTo(from, "APPROVED", {
          hasAllocationPlan: true,
          allocationPlanConfirmed: true,
        });
        if (gate.allowed && sr.status !== "APPROVED") {
          await tx.stockRequest.update({
            where: { id: sr.id },
            data: { status: "APPROVED" },
          });
          await logPlanEvent(tx, {
            orgId,
            allocationPlanId: planId,
            action: "STOCK_REQUEST_APPROVED_ON_PLAN_CONFIRM",
            fromStatus: sr.status,
            toStatus: "APPROVED",
            metadata: { stockRequestId: sr.id },
            performedByUserId: actorUserId ?? null,
          });
        }
      }
    }

    if (plan.parentPlanId != null && plan.stockRequestId) {
      await syncBackordersAfterSupplementaryPlanConfirm(tx, {
        orgId,
        supplementaryPlanId: planId,
        stockRequestId: plan.stockRequestId,
        actorUserId: actorUserId ?? null,
      });
    }

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
        pickLists: { select: { id: true, stockDispatchId: true } },
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
    if (plan.pickLists.some((p) => p.stockDispatchId != null)) {
      throw new Error("Plan already linked to dispatch; cancel pick/dispatch first");
    }

    const shouldReleaseReservation =
      isFulfillmentReservationEnabled() &&
      ["CONFIRMED", "PICKING", "PICKED", "PARTIALLY_DISPATCHED"].includes(plan.status);

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
        multiSource: (plan as any).allocationScope === "MULTI_SOURCE",
      });
    }
    // Cancel backorders linked to this plan
    await tx.backorder.updateMany({
      where: { allocationPlanId: planId, status: { notIn: ["CANCELLED", "CLOSED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    // Cancel source summaries
    await tx.allocationSourceSummary.updateMany({
      where: { allocationPlanId: planId, sourceStatus: { notIn: ["CANCELLED", "DISPATCHED"] } },
      data: { sourceStatus: "CANCELLED" },
    });
    await tx.pickList.deleteMany({ where: { allocationPlanId: planId } });
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
    include: { pickLists: { select: { id: true } } },
  });
  if (!plan) throw new Error("Allocation plan not found");
  if (plan.pickLists.length) {
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
          multiSource: (full as any).allocationScope === "MULTI_SOURCE",
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
