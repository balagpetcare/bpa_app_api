import prisma from "../../../../infrastructure/db/prismaClient";
const transfersService = require("../transfers/transfers.service");
const ledgerService = require("../inventory/ledger.service");

export type CreateRequestInput = {
  orgId: number;
  branchId: number;
  requesterUserId: number;
  items: Array<{ productId: number; variantId: number; requestedQty: number; note?: string }>;
};

export type ListRequestsFilter = {
  branchIds?: number[];
  orgId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

export type DispatchInput = {
  fromLocationId: number;
  toLocationId: number;
  items: Array<{ variantId: number; lotId: number; quantity: number }>;
  createdByUserId?: number;
};

/**
 * Create draft stock request (branch). No batch; product/variant + qty only.
 */
async function createRequest(data: CreateRequestInput) {
  if (!data.items?.length) {
    throw new Error("At least one item is required");
  }
  for (const item of data.items) {
    if (!item.variantId || !item.requestedQty || item.requestedQty <= 0) {
      throw new Error("Each item must have variantId and positive requestedQty");
    }
  }

  const request = await prisma.stockRequest.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      requesterUserId: data.requesterUserId,
      status: "DRAFT",
      items: {
        create: data.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          requestedQty: i.requestedQty,
          note: i.note ?? null,
        })),
      },
    },
    include: {
      branch: { select: { id: true, name: true, orgId: true } },
      requester: { select: { id: true, profile: { select: { displayName: true } } } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
    },
  });
  return request;
}

/**
 * List stock requests with filters. Use branchIds (branch scope) or orgId (owner scope).
 */
async function listRequests(filter: ListRequestsFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filter.branchIds?.length) where.branchId = { in: filter.branchIds };
  if (filter.orgId) where.orgId = filter.orgId;
  if (filter.status) where.status = filter.status;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
    if (filter.dateTo) {
      const d = new Date(filter.dateTo);
      d.setHours(23, 59, 59, 999);
      where.createdAt.lte = d;
    }
  }

  const [items, total] = await Promise.all([
    prisma.stockRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
        transfer: {
          select: { id: true, status: true, sentAt: true, receivedAt: true },
        },
      },
    }),
    prisma.stockRequest.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get single request by id. Optionally include available lots per variant at fromLocationId (for owner fulfill UI).
 */
async function getRequestById(
  requestId: number,
  options?: { fromLocationId?: number }
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: {
      org: { select: { id: true, name: true } },
      branch: {
        select: {
          id: true,
          name: true,
          inventoryLocations: {
            where: { isActive: true },
            select: { id: true, name: true, type: true },
          },
        },
      },
      requester: { select: { id: true, profile: { select: { displayName: true } } } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
      transfer: {
        include: {
          fromLocation: { select: { id: true, name: true } },
          toLocation: { select: { id: true, name: true } },
          items: {
            include: {
              variant: { select: { id: true, sku: true, title: true } },
              lot: { select: { id: true, lotCode: true, expDate: true } },
            },
          },
        },
      },
    },
  });

  if (!request) return null;

  if (options?.fromLocationId && request.items?.length) {
    const variantIds = [...new Set(request.items.map((i) => i.variantId))];
    const lotBalances = await prisma.stockLotBalance.findMany({
      where: {
        locationId: options.fromLocationId,
        lot: { variantId: { in: variantIds } },
      },
      include: {
        lot: {
          select: {
            id: true,
            variantId: true,
            lotCode: true,
            mfgDate: true,
            expDate: true,
          },
        },
      },
    });
    const byVariant: Record<number, Array<{ lotId: number; lotCode: string; expDate: Date; onHandQty: number }>> = {};
    for (const lb of lotBalances) {
      if (lb.onHandQty <= 0) continue;
      const v = lb.lot.variantId;
      if (!byVariant[v]) byVariant[v] = [];
      byVariant[v].push({
        lotId: lb.lot.id,
        lotCode: lb.lot.lotCode,
        expDate: lb.lot.expDate,
        onHandQty: lb.onHandQty,
      });
    }
    (request as any).availableLotsByVariant = byVariant;
  }

  return request;
}

/**
 * Update request items (draft only). Replaces items.
 */
async function updateRequestItems(
  requestId: number,
  items: Array<{ productId: number; variantId: number; requestedQty: number; note?: string }>
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT") {
    throw new Error("Only DRAFT requests can be updated");
  }
  if (!items?.length) throw new Error("At least one item is required");

  await prisma.$transaction(async (tx) => {
    await tx.stockRequestItem.deleteMany({ where: { stockRequestId: requestId } });
    await tx.stockRequest.update({
      where: { id: requestId },
      data: {
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            requestedQty: i.requestedQty,
            note: i.note ?? null,
          })),
        },
      },
    });
  });

  return getRequestById(requestId);
}

/**
 * Submit request (DRAFT → SUBMITTED).
 */
async function submitRequest(requestId: number) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT") throw new Error("Only DRAFT requests can be submitted");
  if (!req.items?.length) throw new Error("Request has no items");

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  return getRequestById(requestId);
}

/**
 * Cancel request (DRAFT or SUBMITTED → CANCELLED).
 */
async function cancelRequest(requestId: number) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT" && req.status !== "SUBMITTED") {
    throw new Error("Only DRAFT or SUBMITTED requests can be cancelled");
  }

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  return getRequestById(requestId);
}

/**
 * Owner: approve request (optional partial qty per variant + extra items). Status → OWNER_REVIEW.
 */
async function approveRequest(
  requestId: number,
  opts: {
    approvedItems: Array<{ variantId: number; approvedQty: number }>;
    extraItems?: Array<{ variantId: number; quantity: number }>;
    approvedByUserId: number;
  }
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(req.status)) {
    throw new Error(`Request cannot be approved in status ${req.status}`);
  }
  const approvedItems = opts.approvedItems ?? [];
  const extraItems = opts.extraItems ?? [];
  if (!approvedItems.length && !extraItems.length) {
    throw new Error("At least one approved item or extra item is required");
  }
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: {
      status: "OWNER_REVIEW",
      approvedItems: approvedItems as any,
      extraItems: extraItems as any,
      approvedAt: new Date(),
      approvedByUserId: opts.approvedByUserId,
    },
  });
  return getRequestById(requestId);
}

/**
 * Owner: decline a submitted stock request with reason/source (auditable).
 */
async function declineRequest(
  requestId: number,
  opts: { reason?: string; source?: string; declinedByUserId: number }
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "SUBMITTED" && req.status !== "OWNER_REVIEW") {
    throw new Error("Only SUBMITTED or OWNER_REVIEW requests can be declined");
  }

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: {
      status: "CANCELLED",
      declinedAt: new Date(),
      declineReason: opts.reason ?? null,
      declineSource: opts.source ?? null,
      declinedByUserId: opts.declinedByUserId,
    },
  });
  return getRequestById(requestId);
}

/**
 * Owner: Create transfer from request (DRAFT, linked to request). Used by fulfillAndDispatch.
 */
async function dispatchRequest(requestId: number, data: DispatchInput): Promise<number> {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true, branch: { select: { id: true } } },
  });
  if (!request) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(request.status)) {
    throw new Error(`Request cannot be dispatched in status ${request.status}`);
  }
  if (!data.items?.length) throw new Error("At least one dispatch item is required");

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      status: "DRAFT",
      stockRequestId: requestId,
      createdByUserId: data.createdByUserId ?? null,
      items: {
        create: data.items.map((i: any) => ({
          variantId: i.variantId,
          lotId: i.lotId,
          quantitySent: i.quantity,
          quantityReceived: 0,
          quantityDamaged: 0,
          quantityExpired: 0,
        })),
      },
    },
  });
  return transfer.id;
}

/**
 * Called after transfer is sent: update request status to DISPATCHED.
 */
export async function markRequestDispatched(requestId: number, _fullFulfilled?: boolean) {
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "DISPATCHED" },
  });
}

/**
 * Called when transfer is received: update linked request to RECEIVED_PARTIAL or RECEIVED_FULL.
 */
export async function markRequestReceivedIfLinked(transferId: number, fullReceived: boolean) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    select: { stockRequestId: true },
  });
  if (!transfer?.stockRequestId) return;
  await prisma.stockRequest.update({
    where: { id: transfer.stockRequestId },
    data: { status: fullReceived ? "RECEIVED_FULL" : "RECEIVED_PARTIAL" },
  });
}

/**
 * Owner: Full dispatch flow — create transfer, send it, update request status.
 */
async function fulfillAndDispatch(requestId: number, data: DispatchInput) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(request.status)) {
    throw new Error(`Request cannot be dispatched in status ${request.status}`);
  }
  if (!data.items?.length) throw new Error("At least one dispatch item is required");

  const totalRequested = request.items.reduce((s, i) => s + i.requestedQty, 0);
  const totalFulfilled = data.items.reduce((s, i) => s + i.quantity, 0);
  const fullFulfilled = totalFulfilled >= totalRequested;

  const transferId = await dispatchRequest(requestId, data);
  await transfersService.sendTransfer(transferId, data.createdByUserId);
  await markRequestDispatched(requestId, fullFulfilled);

  return transfersService.getTransferById(transferId);
}

module.exports = {
  createRequest,
  listRequests,
  getRequestById,
  updateRequestItems,
  submitRequest,
  cancelRequest,
  approveRequest,
  declineRequest,
  fulfillAndDispatch,
  markRequestReceivedIfLinked,
};
