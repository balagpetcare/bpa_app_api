/**
 * Putaway tasks + confirm via stock transfer (send + receive).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const transfersService = require("../transfers/transfers.service");
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { computePutawayRecommendations } from "./putawayRecommendation.service";

export async function enqueuePutawayTasksAfterGrnReceive(grnId: number, orgId: number) {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      location: { select: { id: true, warehouseId: true } },
      lines: { include: { variant: { select: { id: true } } } },
    },
  });
  if (!grn || grn.status !== "RECEIVED") return;
  const whId = grn.location.warehouseId;
  if (!whId) return;

  for (const line of grn.lines) {
    if (!line.lotId || line.quantity < 1) continue;
    const existing = await prisma.putawayTask.findFirst({ where: { grnLineId: line.id } });
    if (existing) continue;

    let recJson: unknown = null;
    try {
      const candidates = await computePutawayRecommendations({
        orgId,
        warehouseId: whId,
        variantId: line.variantId,
        lotId: line.lotId,
        quantity: line.quantity,
        fromLocationId: grn.locationId,
        limit: 6,
      });
      recJson = { candidates, generatedAt: new Date().toISOString() };
    } catch {
      recJson = { candidates: [], error: "recommendation_failed" };
    }

    await prisma.putawayTask.create({
      data: {
        orgId,
        warehouseId: whId,
        grnId: grn.id,
        grnLineId: line.id,
        variantId: line.variantId,
        lotId: line.lotId,
        fromLocationId: grn.locationId,
        quantity: line.quantity,
        status: "OPEN",
        recommendationJson: recJson as object,
      },
    });
  }
}

export async function listPutawayTasks(
  orgId: number,
  opts?: { status?: string; warehouseId?: number; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: any = { orgId };
  if (opts?.status) where.status = opts.status;
  if (opts?.warehouseId) where.warehouseId = opts.warehouseId;

  const [items, total] = await Promise.all([
    prisma.putawayTask.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        grn: { select: { id: true, status: true } },
      },
    }),
    prisma.putawayTask.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getPutawayRecommendationsPreview(params: {
  orgId: number;
  grnLineId: number;
}) {
  const line = await prisma.grnLine.findFirst({
    where: { id: params.grnLineId, grn: { orgId: params.orgId } },
    include: { grn: { include: { location: true } } },
  });
  if (!line?.lotId) throw new Error("GRN line not found or lot not set");
  const whId = line.grn.location.warehouseId;
  if (!whId) throw new Error("Receive location is not warehouse-linked");

  const candidates = await computePutawayRecommendations({
    orgId: params.orgId,
    warehouseId: whId,
    variantId: line.variantId,
    lotId: line.lotId,
    quantity: line.quantity,
    fromLocationId: line.grn.locationId,
    limit: 10,
  });
  return { grnLineId: line.id, candidates };
}

export async function confirmPutawayTask(
  taskId: number,
  orgId: number,
  userId: number,
  toLocationId: number
) {
  const task = await prisma.putawayTask.findFirst({
    where: { id: taskId, orgId, status: "OPEN" },
    include: {
      fromLocation: { include: { branch: true } },
      lot: true,
    },
  });
  if (!task) throw new Error("Putaway task not found or not open");

  const toLoc = await prisma.inventoryLocation.findFirst({
    where: { id: toLocationId, branch: { orgId } },
    include: { branch: true },
  });
  if (!toLoc) throw new Error("Target location not found");
  if (toLoc.id === task.fromLocationId) throw new Error("Target must differ from source");
  if (task.warehouseId != null && toLoc.warehouseId !== task.warehouseId) {
    throw new Error("Putaway target must be in the same warehouse as the receive dock");
  }

  const bin = toLoc.binId
    ? await prisma.warehouseBin.findUnique({
        where: { id: toLoc.binId },
        select: { maxUnits: true, allowMixedSku: true },
      })
    : null;
  if (bin?.maxUnits != null) {
    const bal = await prisma.stockBalance.findMany({ where: { locationId: toLoc.id } });
    const used = bal.reduce((s, b) => s + b.onHandQty, 0);
    const sameSku = bal.find((b) => b.variantId === task.variantId)?.onHandQty ?? 0;
    if (bin.allowMixedSku === false && sameSku === 0 && used > 0) {
      throw new Error("Bin does not allow mixed SKU and already holds other stock");
    }
    if (used + task.quantity > bin.maxUnits) {
      throw new Error(`Target bin capacity exceeded (max ${bin.maxUnits})`);
    }
  }

  const transfer = await transfersService.createTransfer({
    fromLocationId: task.fromLocationId,
    toLocationId: toLoc.id,
    items: [{ variantId: task.variantId, quantity: task.quantity, lotId: task.lotId }],
    createdByUserId: userId,
  });

  await transfersService.sendTransfer(transfer.id, userId);
  const recv = await transfersService.receiveTransfer(transfer.id, {
    items: [
      {
        transferItemId: transfer.items[0].id,
        variantId: task.variantId,
        quantityReceived: task.quantity,
        quantityDamaged: 0,
        quantityExpired: 0,
        lotId: task.lotId,
      },
    ],
    createdByUserId: userId,
  });

  await prisma.putawayTask.update({
    where: { id: taskId },
    data: {
      status: "COMPLETED",
      toLocationId: toLoc.id,
      stockTransferId: transfer.id,
      completedAt: new Date(),
      completedByUserId: userId,
    },
  });

  await logWarehouseAudit({
    orgId,
    warehouseId: task.warehouseId,
    category: "OPERATIONS",
    action: "PUTAWAY_CONFIRM",
    entityType: "PutawayTask",
    entityId: String(taskId),
    metadata: { transferId: transfer.id, toLocationId: toLoc.id },
    actorUserId: userId,
  });

  return recv;
}
