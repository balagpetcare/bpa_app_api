import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * @deprecated WAREHOUSE TRANSFER ORDER MODULE
 *
 * ===============================================================================
 * DEPRECATION NOTICE: WarehouseTransferOrder is superseded by StockDispatch flow.
 * ===============================================================================
 *
 * CANONICAL FLOW (use this instead):
 *   StockRequest → AllocationPlan → PickList → StockDispatch
 *   → sendDispatch (TRANSFER_OUT) → Branch Receive Session → Manager Confirm → Ledger
 *
 * WHY DEPRECATED:
 *   - StockDispatch integrates with controlled receiving (manager confirmation gate)
 *   - StockDispatch supports transport/challan metadata, proof of delivery
 *   - StockDispatch has full discrepancy tracking via DispatchReceiveSession
 *   - StockDispatch integrates with allocation plans, pick lists, and stock requests
 *
 * MIGRATION:
 *   - For inter-warehouse transfers: create StockRequest, then use dispatch flow
 *   - For admin overrides: use direct dispatch createDispatch with appropriate permissions
 *
 * DO NOT CREATE NEW INTEGRATIONS WITH THIS MODULE.
 * Existing WTO records remain readable; new transfers should use StockDispatch.
 *
 * See: docs/VENDOR_RECEIVE_BRANCH_CONFIRMATION_PRICING_GOVERNANCE_PLAN.md
 */

const _includeList = {
  fromLocation: { select: { id: true, name: true, type: true } },
  toLocation: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
  _count: { select: { lines: true } },
} as const;

const _includeDetail = {
  fromLocation: { select: { id: true, name: true, type: true, branch: { select: { id: true, name: true } } } },
  toLocation: { select: { id: true, name: true, type: true, branch: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
  approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  lines: {
    include: {
      variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
      lot: { select: { id: true, lotCode: true, expDate: true } },
      outboundLedger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
      inboundLedger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
    },
  },
} as const;

/** @deprecated Use StockDispatch flow instead. */
export async function createWTO(data: {
  orgId: number;
  fromLocationId: number;
  toLocationId: number;
  note?: string;
  lines: Array<{ variantId: number; lotId?: number; requestedQty: number; note?: string }>;
  createdByUserId: number;
}) {
  console.warn("[DEPRECATED] createWTO called. Use StockDispatch flow instead.");
  if (data.fromLocationId === data.toLocationId) {
    throw new Error("Source and destination locations must be different");
  }
  return prisma.warehouseTransferOrder.create({
    data: {
      orgId: data.orgId,
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      note: data.note,
      createdByUserId: data.createdByUserId,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          lotId: l.lotId ?? null,
          requestedQty: l.requestedQty,
          note: l.note,
        })),
      },
    },
    include: _includeDetail,
  });
}

export async function listWTO(opts: {
  orgId?: number;
  fromLocationId?: number;
  toLocationId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const where: any = {};
  if (opts.orgId) where.orgId = opts.orgId;
  if (opts.fromLocationId) where.fromLocationId = opts.fromLocationId;
  if (opts.toLocationId) where.toLocationId = opts.toLocationId;
  if (opts.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.warehouseTransferOrder.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { createdAt: "desc" },
      include: _includeList,
    }),
    prisma.warehouseTransferOrder.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getWTO(id: number) {
  const r = await prisma.warehouseTransferOrder.findUnique({ where: { id }, include: _includeDetail });
  if (!r) throw new Error("Warehouse transfer order not found");
  return r;
}

export async function approveWTO(id: number, approvedByUserId: number) {
  const r = await prisma.warehouseTransferOrder.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Warehouse transfer order not found");
  if (r.status !== "DRAFT") throw new Error(`Cannot approve from status ${r.status}`);
  return prisma.warehouseTransferOrder.update({
    where: { id },
    data: { status: "APPROVED", approvedByUserId, approvedAt: new Date() },
    include: _includeDetail,
  });
}

export async function pickWTO(id: number, pickedLines: Array<{ lineId: number; pickedQty: number }>, userId: number) {
  const r = await prisma.warehouseTransferOrder.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Warehouse transfer order not found");
  if (r.status !== "APPROVED") throw new Error(`Cannot pick from status ${r.status}`);

  await Promise.all(
    pickedLines.map((pl) =>
      prisma.warehouseTransferOrderLine.update({
        where: { id: pl.lineId },
        data: { pickedQty: pl.pickedQty },
      })
    )
  );

  return prisma.warehouseTransferOrder.update({
    where: { id },
    data: { status: "PICKING" },
    include: _includeDetail,
  });
}

export async function dispatchWTO(id: number, userId: number) {
  const r = await prisma.warehouseTransferOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!r) throw new Error("Warehouse transfer order not found");
  if (!["APPROVED", "PICKING"].includes(r.status)) throw new Error(`Cannot dispatch from status ${r.status}`);

  return prisma.$transaction(async (tx) => {
    for (const line of r.lines) {
      const qty = line.pickedQty > 0 ? line.pickedQty : line.requestedQty;
      if (qty <= 0) continue;

      const ledger = await tx.stockLedger.create({
        data: {
          orgId: r.orgId,
          locationId: r.fromLocationId,
          variantId: line.variantId,
          lotId: line.lotId,
          type: "TRANSFER_OUT",
          quantityDelta: -qty,
          refType: "WTO",
          refId: String(r.id),
          createdByUserId: userId,
        },
      });

      if (line.lotId) {
        await tx.stockLotBalance.updateMany({
          where: { locationId: r.fromLocationId, lotId: line.lotId },
          data: { onHandQty: { decrement: qty } },
        });
      }
      await tx.stockBalance.updateMany({
        where: { locationId: r.fromLocationId, variantId: line.variantId },
        data: { onHandQty: { decrement: qty } },
      });

      await tx.warehouseTransferOrderLine.update({
        where: { id: line.id },
        data: { pickedQty: qty, outboundLedgerId: ledger.id },
      });
    }

    return tx.warehouseTransferOrder.update({
      where: { id },
      data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
      include: _includeDetail,
    });
  });
}

export async function receiveWTO(
  id: number,
  receivedLines: Array<{ lineId: number; receivedQty: number }>,
  userId: number
) {
  const r = await prisma.warehouseTransferOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!r) throw new Error("Warehouse transfer order not found");
  if (r.status !== "IN_TRANSIT") throw new Error(`Cannot receive from status ${r.status}`);

  return prisma.$transaction(async (tx) => {
    for (const rl of receivedLines) {
      const line = r.lines.find((l) => l.id === rl.lineId);
      if (!line || rl.receivedQty <= 0) continue;

      const ledger = await tx.stockLedger.create({
        data: {
          orgId: r.orgId,
          locationId: r.toLocationId,
          variantId: line.variantId,
          lotId: line.lotId,
          type: "TRANSFER_IN",
          quantityDelta: rl.receivedQty,
          refType: "WTO",
          refId: String(r.id),
          createdByUserId: userId,
        },
      });

      if (line.lotId) {
        const existing = await tx.stockLotBalance.findUnique({
          where: { locationId_lotId: { locationId: r.toLocationId, lotId: line.lotId } },
        });
        if (existing) {
          await tx.stockLotBalance.update({
            where: { locationId_lotId: { locationId: r.toLocationId, lotId: line.lotId } },
            data: { onHandQty: { increment: rl.receivedQty } },
          });
        } else {
          await tx.stockLotBalance.create({
            data: { locationId: r.toLocationId, lotId: line.lotId, onHandQty: rl.receivedQty, reservedQty: 0 },
          });
        }
      }

      const existing = await tx.stockBalance.findUnique({
        where: { locationId_variantId: { locationId: r.toLocationId, variantId: line.variantId } },
      });
      if (existing) {
        await tx.stockBalance.update({
          where: { locationId_variantId: { locationId: r.toLocationId, variantId: line.variantId } },
          data: { onHandQty: { increment: rl.receivedQty } },
        });
      } else {
        await tx.stockBalance.create({
          data: { locationId: r.toLocationId, variantId: line.variantId, onHandQty: rl.receivedQty, reservedQty: 0 },
        });
      }

      await tx.warehouseTransferOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: rl.receivedQty, inboundLedgerId: ledger.id },
      });
    }

    return tx.warehouseTransferOrder.update({
      where: { id },
      data: { status: "RECEIVED", receivedAt: new Date() },
      include: _includeDetail,
    });
  });
}

export async function closeWTO(id: number) {
  const r = await prisma.warehouseTransferOrder.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Warehouse transfer order not found");
  if (r.status !== "RECEIVED") throw new Error(`Cannot close from status ${r.status}`);
  return prisma.warehouseTransferOrder.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
    include: _includeDetail,
  });
}
