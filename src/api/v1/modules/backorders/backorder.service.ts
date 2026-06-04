/**
 * Backorder management service.
 *
 * Tracks unmet demand from allocation plans and drives supplementary
 * allocation or procurement linkage.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export type BackorderFilter = {
  orgId: number;
  status?: string;
  stockRequestId?: number;
  variantId?: number;
  page?: number;
  limit?: number;
};

export async function listBackorders(filter: BackorderFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { orgId: filter.orgId };
  if (filter.status) where.status = filter.status;
  if (filter.stockRequestId) where.stockRequestId = filter.stockRequestId;
  if (filter.variantId) where.variantId = filter.variantId;

  const [items, total] = await Promise.all([
    prisma.backorder.findMany({
      where: where as any,
      skip,
      take: limit,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        stockRequest: { select: { id: true, status: true, branchId: true } },
        stockRequestItem: { select: { id: true, requestedQty: true } },
        allocationPlan: { select: { id: true, status: true } },
        procurementDemandLine: { select: { id: true, status: true } },
      },
    }),
    prisma.backorder.count({ where: where as any }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getBackorderById(id: number, orgId: number) {
  return prisma.backorder.findFirst({
    where: { id, orgId },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      stockRequest: {
        select: {
          id: true,
          status: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
        },
      },
      stockRequestItem: {
        select: { id: true, requestedQty: true, fulfilledQty: true, backorderStatus: true },
      },
      allocationPlan: { select: { id: true, status: true, fromLocationId: true } },
      procurementDemandLine: { select: { id: true, status: true, purchaseOrderId: true } },
      supplementaryPlan: { select: { id: true, status: true } },
    },
  });
}

/**
 * Create backorder records from allocation plan shortages.
 * Called during plan confirmation when shortageQty > 0.
 */
export async function createBackordersFromPlanShortage(
  tx: any,
  params: {
    orgId: number;
    allocationPlanId: number;
    stockRequestId: number;
    shortages: Array<{
      variantId: number;
      shortageQty: number;
      stockRequestItemId?: number | null;
    }>;
    priority?: number;
  },
): Promise<number> {
  let created = 0;

  for (const shortage of params.shortages) {
    if (shortage.shortageQty <= 0) continue;

    const existing = await tx.backorder.findFirst({
      where: {
        orgId: params.orgId,
        allocationPlanId: params.allocationPlanId,
        variantId: shortage.variantId,
        status: { notIn: ["CANCELLED", "CLOSED"] },
      },
    });
    if (existing) continue;

    await tx.backorder.create({
      data: {
        orgId: params.orgId,
        stockRequestId: params.stockRequestId,
        stockRequestItemId: shortage.stockRequestItemId ?? null,
        allocationPlanId: params.allocationPlanId,
        variantId: shortage.variantId,
        shortageQty: shortage.shortageQty,
        remainingQty: shortage.shortageQty,
        fulfilledQty: 0,
        status: "OPEN",
        priority: params.priority ?? 0,
      },
    });
    created++;
  }

  return created;
}

export async function updateBackorder(
  id: number,
  orgId: number,
  data: {
    notes?: string;
    procurementDemandLineId?: number;
    status?: string;
  },
) {
  const bo = await prisma.backorder.findFirst({ where: { id, orgId } });
  if (!bo) throw new Error("Backorder not found");
  if (["CLOSED", "CANCELLED"].includes(bo.status)) {
    throw new Error(`Cannot update backorder in terminal status ${bo.status}`);
  }

  const update: Record<string, unknown> = {};
  if (data.notes !== undefined) update.notes = data.notes;

  if (data.procurementDemandLineId != null) {
    update.procurementDemandLineId = data.procurementDemandLineId;
    if (bo.status === "OPEN") update.status = "PROCUREMENT_LINKED";
  }

  if (data.status === "FULFILLED") {
    update.status = "FULFILLED";
    update.fulfilledQty = bo.shortageQty;
    update.remainingQty = 0;
  }

  return prisma.backorder.update({
    where: { id },
    data: update as any,
  });
}

export async function cancelBackorder(id: number, orgId: number) {
  const bo = await prisma.backorder.findFirst({ where: { id, orgId } });
  if (!bo) throw new Error("Backorder not found");
  if (["CLOSED", "CANCELLED"].includes(bo.status)) {
    throw new Error(`Backorder is already in terminal status ${bo.status}`);
  }

  return prisma.backorder.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
}

export async function closeBackorder(id: number, orgId: number) {
  const bo = await prisma.backorder.findFirst({ where: { id, orgId } });
  if (!bo) throw new Error("Backorder not found");
  if (bo.status === "CLOSED") return bo;
  if (bo.status === "CANCELLED") throw new Error("Cannot close a cancelled backorder");

  return prisma.backorder.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
}

/**
 * After supplementary allocation plan is confirmed and reserved, distribute allocated qty
 * across LINKED backorders (FIFO per variant) and advance OPEN → LINKED → PARTIALLY_FULFILLED → FULFILLED.
 * CLOSED is applied when the stock request is fully received (see {@link closeFulfilledBackordersForStockRequest}).
 */
export async function syncBackordersAfterSupplementaryPlanConfirm(
  tx: any,
  params: {
    orgId: number;
    supplementaryPlanId: number;
    stockRequestId: number;
    actorUserId?: number | null;
  }
): Promise<void> {
  const lines = await tx.allocationPlanLine.findMany({
    where: { allocationPlanId: params.supplementaryPlanId, quantityAllocated: { gt: 0 } },
    select: { variantId: true, quantityAllocated: true },
  });
  const pool = new Map<number, number>();
  for (const l of lines) {
    pool.set(l.variantId, (pool.get(l.variantId) ?? 0) + l.quantityAllocated);
  }

  const backorders = await tx.backorder.findMany({
    where: {
      orgId: params.orgId,
      stockRequestId: params.stockRequestId,
      supplementaryPlanId: params.supplementaryPlanId,
      status: { notIn: ["CANCELLED", "CLOSED"] },
    },
    orderBy: { id: "asc" },
  });

  for (const bo of backorders) {
    const available = pool.get(bo.variantId) ?? 0;
    if (bo.remainingQty <= 0) continue;

    const take = Math.min(bo.remainingQty, available);
    if (take > 0) {
      pool.set(bo.variantId, available - take);
    }

    const newRem = bo.remainingQty - take;
    const newFul = bo.fulfilledQty + take;
    let nextStatus: string = bo.status;
    if (newRem === 0) {
      nextStatus = "FULFILLED";
    } else if (take > 0) {
      nextStatus = "PARTIALLY_FULFILLED";
    }

    await tx.backorder.update({
      where: { id: bo.id },
      data: {
        remainingQty: newRem,
        fulfilledQty: newFul,
        status: nextStatus as any,
      },
    });
  }
}

/**
 * When enterprise receive completes the stock request, close backorders that were fully covered (FULFILLED).
 */
export async function closeFulfilledBackordersForStockRequest(tx: any, stockRequestId: number): Promise<void> {
  await tx.backorder.updateMany({
    where: {
      stockRequestId,
      status: "FULFILLED",
      remainingQty: 0,
    },
    data: { status: "CLOSED", closedAt: new Date() },
  });
}
