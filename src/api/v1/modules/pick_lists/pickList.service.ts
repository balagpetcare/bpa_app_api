/**
 * Pick lists: allocation → picking → dispatch handoff (stock request path).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as dispatchService from "../dispatches/dispatches.service";
import { logWarehouseAuditInTx } from "../warehouse/warehouseAudit.service";

export async function createPickListFromPlan(planId: number, orgId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "allocation_plans" WHERE id = ${planId} AND "orgId" = ${orgId} FOR UPDATE`;

    const plan = await tx.allocationPlan.findFirst({
      where: { id: planId, orgId, status: "CONFIRMED" },
      include: { lines: true, pickList: true },
    });
    if (!plan) throw new Error("Confirmed allocation plan not found");
    if (plan.pickList) throw new Error("Pick list already exists for this plan");
    const linesToPick = plan.lines.filter((l) => l.quantityAllocated > 0);
    if (!linesToPick.length) throw new Error("Allocation plan has no positive quantity lines to pick");

    const pl = await tx.pickList.create({
      data: {
        orgId,
        allocationPlanId: planId,
        fromLocationId: plan.fromLocationId,
        status: "DRAFT",
      },
    });

    for (const line of linesToPick) {
      await tx.pickListLine.create({
        data: {
          pickListId: pl.id,
          allocationPlanLineId: line.id,
          variantId: line.variantId,
          lotId: line.lotId,
          locationId: line.locationId,
          quantityToPick: line.quantityAllocated,
          quantityPicked: 0,
        },
      });
    }

    await tx.allocationPlan.update({
      where: { id: planId },
      data: { status: "PICKING" },
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
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: "PICKING" },
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

export async function completePicking(pickListId: number, orgId: number, actorUserId?: number) {
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
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: "PICKED" },
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
      throw new Error("Allocation plan is already DISPATCHED; refresh and verify dispatch link");
    }
    if (ap.status !== "PICKED") {
      throw new Error(`Handoff requires allocation plan in PICKED status (current: ${ap.status})`);
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

    const dispatch = await dispatchService.createDispatch(
      {
        orgId,
        stockRequestId: srId ?? null,
        medicineRequisitionId: mrId ?? null,
        fromLocationId: pl.fromLocationId,
        toLocationId: data.toLocationId,
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
    await tx.allocationPlan.update({
      where: { id: pl.allocationPlanId },
      data: { status: "DISPATCHED" },
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
          medicineRequisition: { select: { id: true, requisitionNumber: true } },
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
  opts?: { status?: string; assignedPickerUserId?: number; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: any = { orgId };
  if (opts?.status) where.status = opts.status;
  if (opts?.assignedPickerUserId) where.assignedPickerUserId = opts.assignedPickerUserId;

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
