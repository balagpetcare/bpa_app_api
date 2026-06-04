/**
 * Pick lists: allocation → picking → dispatch handoff (stock request path).
 */
import type { AllocationPlanStatus, Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import * as dispatchService from "../dispatches/dispatches.service";
import { logWarehouseAuditInTx } from "../warehouse/warehouseAudit.service";
import type { PickListLineUpdatePayload } from "./pickListLinePayload";

export type { PickListLineUpdatePayload } from "./pickListLinePayload";
export { parsePickListLineUpdatesFromBody } from "./pickListLinePayload";

const CREATE_PICK_PLAN_STATUSES = new Set([
  "CONFIRMED",
  "PICKING",
  "PICKED",
  "PARTIALLY_DISPATCHED",
]);

async function sumPickedQtyByAllocationPlanLineId(
  tx: Prisma.TransactionClient,
  allocationPlanId: number
): Promise<Map<number, number>> {
  const rows = await tx.pickListLine.findMany({
    where: {
      allocationPlanLineId: { not: null },
      allocationPlanLine: { allocationPlanId },
    },
    select: { allocationPlanLineId: true, quantityPicked: true },
  });
  const m = new Map<number, number>();
  for (const r of rows) {
    if (r.allocationPlanLineId == null) continue;
    m.set(r.allocationPlanLineId, (m.get(r.allocationPlanLineId) ?? 0) + r.quantityPicked);
  }
  return m;
}

async function hasRemainingToPickAgainstPlan(
  tx: Prisma.TransactionClient,
  allocationPlanId: number
): Promise<boolean> {
  const lines = await tx.allocationPlanLine.findMany({
    where: { allocationPlanId, quantityAllocated: { gt: 0 } },
    select: { id: true, quantityAllocated: true },
  });
  const picked = await sumPickedQtyByAllocationPlanLineId(tx, allocationPlanId);
  for (const line of lines) {
    const p = picked.get(line.id) ?? 0;
    if (p < line.quantityAllocated) return true;
  }
  return false;
}

/** Warehouse queue / owner UI: which pick list row to treat as “current”. */
export function selectPrimaryPickListForPlan<
  T extends {
    id: number;
    status: string;
    stockDispatchId: number | null;
    dispatch?: { status: string } | null;
  },
>(pickLists: T[] | null | undefined): T | null {
  if (!pickLists?.length) return null;
  const list = [...pickLists].sort((a, b) => b.id - a.id);
  const open = list.filter((p) => ["DRAFT", "IN_PROGRESS"].includes((p.status || "").toUpperCase()));
  if (open.length) return open[0];
  const completedNoDispatch = list.filter(
    (p) => (p.status || "").toUpperCase() === "COMPLETED" && p.stockDispatchId == null
  );
  if (completedNoDispatch.length) return completedNoDispatch[0];
  return list[0];
}

export async function createPickListFromPlan(planId: number, orgId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${planId} AND "orgId" = ${orgId} FOR UPDATE`;

    const plan = await tx.allocationPlan.findFirst({
      where: { id: planId, orgId },
      include: {
        lines: true,
        pickLists: { select: { id: true, status: true, stockDispatchId: true } },
      },
    });
    if (!plan) throw new Error("Allocation plan not found");

    if (plan.status === "DISPATCHED") {
      const stillRemaining = await hasRemainingToPickAgainstPlan(tx, planId);
      if (!stillRemaining) {
        throw new Error("Allocation plan is fully dispatched; no further pick lists are needed");
      }
    } else if (!CREATE_PICK_PLAN_STATUSES.has(plan.status)) {
      throw new Error(`Cannot create pick list for plan in status ${plan.status}`);
    }

    const blockingOpen = await tx.pickList.findFirst({
      where: {
        allocationPlanId: planId,
        status: { in: ["DRAFT", "IN_PROGRESS"] },
      },
    });
    if (blockingOpen) {
      throw new Error(
        `Pick list #${blockingOpen.id} is still open (${blockingOpen.status}); complete or cancel it before starting another wave`
      );
    }

    const blockingCompletedNoHandoff = await tx.pickList.findFirst({
      where: {
        allocationPlanId: planId,
        status: "COMPLETED",
        stockDispatchId: null,
      },
    });
    if (blockingCompletedNoHandoff) {
      throw new Error(
        `Pick list #${blockingCompletedNoHandoff.id} is completed but not handed off to dispatch; hand off before starting another wave`
      );
    }

    const pickedMap = await sumPickedQtyByAllocationPlanLineId(tx, planId);
    const linesToPick: { line: (typeof plan.lines)[0]; remaining: number }[] = [];
    for (const line of plan.lines) {
      if (line.quantityAllocated <= 0) continue;
      const picked = pickedMap.get(line.id) ?? 0;
      const remaining = line.quantityAllocated - picked;
      if (remaining > 0) {
        linesToPick.push({ line, remaining });
      }
    }
    if (!linesToPick.length) {
      throw new Error("No remaining allocated quantity to pick for this plan (all lines are fully picked)");
    }

    const pl = await tx.pickList.create({
      data: {
        orgId,
        allocationPlanId: planId,
        fromLocationId: plan.fromLocationId,
        status: "DRAFT",
      },
    });

    for (const { line, remaining } of linesToPick) {
      await tx.pickListLine.create({
        data: {
          pickListId: pl.id,
          allocationPlanLineId: line.id,
          variantId: line.variantId,
          lotId: line.lotId,
          locationId: line.locationId,
          quantityToPick: remaining,
          quantityPicked: 0,
        },
      });
    }

    const nextAfterCreate =
      plan.status === "PARTIALLY_DISPATCHED" ? "PARTIALLY_DISPATCHED" : "PICKING";
    await tx.allocationPlan.update({
      where: { id: planId },
      data: { status: nextAfterCreate },
    });

    return tx.pickList.findUnique({
      where: { id: pl.id },
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true, barcode: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
            location: { select: { id: true, name: true, zone: { select: { id: true, code: true, name: true } } } },
          },
        },
        allocationPlan: {
          select: { id: true, stockRequestId: true, medicineRequisitionId: true, status: true },
        },
      },
    });
  });
}

export async function assignPicker(pickListId: number, orgId: number, pickerUserId: number) {
  const pl = await prisma.pickList.findFirst({ where: { id: pickListId, orgId } });
  if (!pl) throw new Error("Pick list not found");
  if (["COMPLETED", "CANCELLED"].includes(pl.status)) {
    throw new Error(`Cannot assign picker in status ${pl.status}`);
  }
  return prisma.pickList.update({
    where: { id: pickListId },
    data: { assignedPickerUserId: pickerUserId },
    include: { lines: true, allocationPlan: true },
  });
}

export async function startPicking(pickListId: number, orgId: number, userId: number) {
  const pl = await prisma.pickList.findFirst({
    where: { id: pickListId, orgId },
    include: { allocationPlan: true },
  });
  if (!pl) throw new Error("Pick list not found");
  if (pl.assignedPickerUserId != null && pl.assignedPickerUserId !== userId) {
    throw new Error("Pick list is assigned to another user");
  }
  if (!["DRAFT", "IN_PROGRESS"].includes(pl.status)) {
    throw new Error(`Cannot start picking in status ${pl.status}`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.pickList.update({
      where: { id: pickListId },
      data: {
        status: "IN_PROGRESS",
        startedAt: pl.startedAt ?? new Date(),
        assignedPickerUserId: pl.assignedPickerUserId ?? userId,
      },
    });
    const planRow = await tx.allocationPlan.findUnique({
      where: { id: pl.allocationPlanId },
      select: { status: true },
    });
    const nextAfterStart =
      planRow?.status === "PARTIALLY_DISPATCHED" ? "PARTIALLY_DISPATCHED" : "PICKING";
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: nextAfterStart },
    });
    const fromLoc = await tx.inventoryLocation.findUnique({
      where: { id: pl.fromLocationId },
      select: { warehouseId: true },
    });
    await logWarehouseAuditInTx(tx, {
      orgId: pl.orgId,
      warehouseId: fromLoc?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "PICK_START",
      entityType: "PickList",
      entityId: String(pickListId),
      metadata: { allocationPlanId: pl.allocationPlanId },
      actorUserId: userId,
    });
    return updated;
  });
}

export async function updatePickLine(
  pickListId: number,
  lineId: number,
  orgId: number,
  quantityPicked: number
) {
  const line = await prisma.pickListLine.findFirst({
    where: { id: lineId, pickListId, pickList: { orgId } },
    include: {
      pickList: { select: { id: true, status: true } },
      variant: { select: { sku: true } },
    },
  });
  if (!line) throw new Error("Pick line not found");
  if (!["DRAFT", "IN_PROGRESS"].includes(line.pickList.status)) {
    throw new Error(`Pick list is not open for edits (status ${line.pickList.status})`);
  }
  if (quantityPicked < 0 || quantityPicked > line.quantityToPick) {
    const sku = line.variant?.sku ?? "?";
    throw new Error(
      `Pick line ${lineId} (SKU ${sku}): quantityPicked must be between 0 and ${line.quantityToPick} (received ${quantityPicked})`
    );
  }

  return prisma.pickListLine.update({
    where: { id: lineId },
    data: { quantityPicked },
    include: {
      variant: { select: { id: true, sku: true, title: true, barcode: true } },
      lot: { select: { id: true, lotCode: true } },
    },
  });
}

export async function completePicking(
  pickListId: number,
  orgId: number,
  actorUserId?: number,
  options?: { lineUpdates?: PickListLineUpdatePayload[] }
) {
  const pl = await prisma.pickList.findFirst({
    where: { id: pickListId, orgId },
    include: { lines: true },
  });
  if (!pl) throw new Error("Pick list not found");
  if (pl.stockDispatchId) throw new Error("Pick list already handed off to dispatch");
  if (pl.status === "COMPLETED") {
    return prisma.pickList.findUnique({
      where: { id: pickListId },
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true, barcode: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
            location: { select: { id: true, name: true, zone: { select: { id: true, code: true, name: true } } } },
          },
        },
        allocationPlan: true,
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    if (options?.lineUpdates?.length) {
      if (process.env.NODE_ENV !== "production") {
        console.info("[pickList.complete] applying lineUpdates before validation", {
          pickListId,
          count: options.lineUpdates.length,
        });
      }
      for (const u of options.lineUpdates) {
        const line = await tx.pickListLine.findFirst({
          where: {
            id: u.lineId,
            pickListId,
            pickList: { orgId, status: { in: ["DRAFT", "IN_PROGRESS"] } },
          },
          include: { variant: { select: { sku: true } } },
        });
        if (!line) {
          throw new Error(`Pick line ${u.lineId} not found or pick list is not open for edits`);
        }
        const q = u.quantityPicked;
        if (q < 0 || q > line.quantityToPick) {
          const sku = line.variant?.sku ?? "?";
          throw new Error(
            `Pick line ${u.lineId} (SKU ${sku}): quantityPicked must be between 0 and ${line.quantityToPick} (received ${q})`
          );
        }
        await tx.pickListLine.update({
          where: { id: u.lineId },
          data: { quantityPicked: q },
        });
      }
    }

    const refreshed = await tx.pickListLine.findMany({
      where: { pickListId },
      include: { variant: { select: { sku: true } } },
    });
    let anyPositive = false;
    for (const l of refreshed) {
      if (l.quantityPicked < 0 || l.quantityPicked > l.quantityToPick) {
        const sku = l.variant?.sku ?? "?";
        throw new Error(
          `Line ${l.id} (SKU ${sku}): quantityPicked must be between 0 and ${l.quantityToPick} (current ${l.quantityPicked})`
        );
      }
      if (l.quantityPicked > 0) anyPositive = true;
    }
    if (!anyPositive) {
      throw new Error("At least one line must have quantity picked > 0 (use partial quantities or cancel the pick)");
    }
    const updated = await tx.pickList.update({
      where: { id: pickListId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const pickedTotals = await sumPickedQtyByAllocationPlanLineId(tx, pl.allocationPlanId);
    const planLines = await tx.allocationPlanLine.findMany({
      where: { allocationPlanId: pl.allocationPlanId, quantityAllocated: { gt: 0 } },
      select: { id: true, quantityAllocated: true },
    });
    let allAllocatedQtyPicked = true;
    for (const al of planLines) {
      const p = pickedTotals.get(al.id) ?? 0;
      if (p < al.quantityAllocated) {
        allAllocatedQtyPicked = false;
        break;
      }
    }
    const prevPlan = await tx.allocationPlan.findUnique({
      where: { id: pl.allocationPlanId },
      select: { status: true },
    });
    const nextAfterComplete: AllocationPlanStatus = allAllocatedQtyPicked
      ? "PICKED"
      : prevPlan?.status === "PARTIALLY_DISPATCHED"
        ? "PARTIALLY_DISPATCHED"
        : "PICKING";
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: nextAfterComplete },
    });
    const fromLoc = await tx.inventoryLocation.findUnique({
      where: { id: pl.fromLocationId },
      select: { warehouseId: true },
    });
    await logWarehouseAuditInTx(tx, {
      orgId,
      warehouseId: fromLoc?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "PICK_COMPLETE",
      entityType: "PickList",
      entityId: String(pickListId),
      metadata: {
        partial: refreshed.some((l) => l.quantityPicked < l.quantityToPick && l.quantityPicked > 0),
        lines: refreshed.map((l) => ({ id: l.id, toPick: l.quantityToPick, picked: l.quantityPicked })),
      },
      actorUserId: actorUserId ?? null,
    });
    return tx.pickList.findUnique({
      where: { id: pickListId },
      include: {
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true, barcode: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
            location: { select: { id: true, name: true, zone: { select: { id: true, code: true, name: true } } } },
          },
        },
        allocationPlan: true,
      },
    });
  });
}

const handoffReturnInclude = {
  dispatch: {
    include: {
      toLocation: { select: { id: true, name: true, branchId: true } },
      items: { include: { variant: { select: { id: true, sku: true, title: true, barcode: true } } } },
    },
  },
  lines: true,
} as const;

export async function handoffToDispatch(
  pickListId: number,
  orgId: number,
  data: {
    /** Required: must be an active inventory location on the stock request / MR destination branch. */
    toLocationId: number;
    transport?: dispatchService.CreateDispatchInput["transport"];
    createdByUserId: number;
  }
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "pick_lists" WHERE id = ${pickListId} AND "orgId" = ${orgId} FOR UPDATE`;

    const pl = await tx.pickList.findFirst({
      where: { id: pickListId, orgId },
      include: {
        lines: true,
        allocationPlan: true,
      },
    });
    if (!pl) throw new Error("Pick list not found");

    if (pl.stockDispatchId != null) {
      const existing = await tx.pickList.findUnique({
        where: { id: pickListId },
        include: handoffReturnInclude,
      });
      if (!existing) throw new Error("Pick list not found");
      return existing;
    }

    if (pl.status !== "COMPLETED") {
      throw new Error(`Handoff requires pick list in COMPLETED status (current: ${pl.status})`);
    }

    const ap = pl.allocationPlan;
    if (ap.status === "DISPATCHED") {
      const stillRemaining = await hasRemainingToPickAgainstPlan(tx, pl.allocationPlanId);
      if (!stillRemaining) {
        throw new Error("Allocation plan is already fully DISPATCHED; refresh and verify dispatch link");
      }
    }
    const allowedHandoffPlanStatuses = ["PICKING", "PICKED", "PARTIALLY_DISPATCHED"];
    if (!allowedHandoffPlanStatuses.includes(ap.status)) {
      throw new Error(
        `Handoff requires allocation plan in ${allowedHandoffPlanStatuses.join(", ")} (current: ${ap.status})`
      );
    }

    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${pl.allocationPlanId} AND "orgId" = ${orgId} FOR UPDATE`;

    const items = pl.lines
      .filter((l) => l.quantityPicked > 0)
      .map((l) => ({
        variantId: l.variantId,
        lotId: l.lotId,
        quantity: l.quantityPicked,
      }));
    if (!items.length) {
      throw new Error("No picked quantities to dispatch; complete picking with at least one line > 0");
    }

    const srId = ap.stockRequestId;
    const mrId = ap.medicineRequisitionId;
    if (!srId && !mrId) {
      throw new Error("Allocation plan has no stock request or medicine requisition");
    }

    let toLocationId = data.toLocationId;
    if (toLocationId == null || !Number.isFinite(toLocationId)) {
      throw new Error(
        "toLocationId is required — select the destination branch receive location (active inventory location on the requester branch)."
      );
    }
    toLocationId = Math.floor(Number(toLocationId));
    if (toLocationId <= 0) throw new Error("Invalid toLocationId");

    const dispatch = await dispatchService.createDispatch(
      {
        orgId,
        stockRequestId: srId ?? null,
        medicineRequisitionId: mrId ?? null,
        fromLocationId: pl.fromLocationId,
        toLocationId,
        items,
        transport: data.transport,
        createdByUserId: data.createdByUserId,
        pickListId: pl.id,
      },
      { tx }
    );

    await tx.pickList.update({
      where: { id: pickListId },
      data: { stockDispatchId: dispatch.id },
    });
    const stillRemainingAfterHandoff = await hasRemainingToPickAgainstPlan(tx, pl.allocationPlanId);
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: stillRemainingAfterHandoff ? "PARTIALLY_DISPATCHED" : "DISPATCHED" },
    });

    const fromLoc = await tx.inventoryLocation.findUnique({
      where: { id: pl.fromLocationId },
      select: { warehouseId: true },
    });
    await logWarehouseAuditInTx(tx, {
      orgId,
      warehouseId: fromLoc?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "PICK_HANDOFF_DISPATCH",
      entityType: "StockDispatch",
      entityId: String(dispatch.id),
      metadata: {
        pickListId,
        allocationPlanId: pl.allocationPlanId,
        stockRequestId: srId,
        medicineRequisitionId: mrId,
      },
      actorUserId: data.createdByUserId ?? null,
    });

    const result = await tx.pickList.findUnique({
      where: { id: pickListId },
      include: handoffReturnInclude,
    });
    if (!result) throw new Error("Pick list not found after handoff");
    return result;
  });
}

export async function getPickListById(pickListId: number, orgId: number) {
  return prisma.pickList.findFirst({
    where: { id: pickListId, orgId },
    include: {
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true, barcode: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
          location: { select: { id: true, name: true, zone: { select: { id: true, code: true, name: true } } } },
        },
      },
      allocationPlan: {
        include: {
          stockRequest: { select: { id: true, status: true, branchId: true } },
          medicineRequisition: { select: { id: true, requisitionNumber: true, branchId: true } },
        },
      },
      dispatch: {
        include: {
          proofOfDelivery: true,
          toLocation: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function listPickLists(
  orgId: number,
  opts?: {
    status?: string;
    /** Strict filter: only lists assigned to this user. */
    assignedPickerUserId?: number;
    /**
     * Picker queue: lists assigned to this user OR still unassigned (null).
     * Excludes lists claimed by someone else — required so DRAFT picks from allocation plans
     * (created with no assignee) appear for warehouse staff.
     */
    workQueueForUserId?: number;
    /** Scope to pick-from locations belonging to this branch (staff branch context). */
    fromLocationBranchId?: number;
    page?: number;
    limit?: number;
  }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const clauses: Prisma.PickListWhereInput[] = [{ orgId }];

  if (opts?.fromLocationBranchId != null && Number.isFinite(opts.fromLocationBranchId)) {
    const bid = opts.fromLocationBranchId;
    clauses.push({
      OR: [
        { fromLocation: { branchId: bid } },
        { fromLocation: { warehouse: { branchId: bid } } },
      ],
    });
  }

  if (opts?.workQueueForUserId != null && Number.isFinite(opts.workQueueForUserId)) {
    const uid = opts.workQueueForUserId;
    clauses.push({
      OR: [{ assignedPickerUserId: uid }, { assignedPickerUserId: null }],
    });
  } else if (opts?.assignedPickerUserId != null && Number.isFinite(opts.assignedPickerUserId)) {
    clauses.push({ assignedPickerUserId: opts.assignedPickerUserId });
  }

  if (opts?.status) {
    clauses.push({ status: opts.status as any });
  }

  const where: Prisma.PickListWhereInput = clauses.length === 1 ? clauses[0] : { AND: clauses };

  const [items, total] = await Promise.all([
    prisma.pickList.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        allocationPlan: {
          select: { id: true, stockRequestId: true, medicineRequisitionId: true, status: true },
        },
        _count: { select: { lines: true } },
      },
    }),
    prisma.pickList.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
