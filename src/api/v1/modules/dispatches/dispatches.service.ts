/**
 * Stock Dispatch (Challan/DO) service.
 * Create dispatch from fulfill plan; send = ledger TRANSFER_OUT; receive = GRN + ledger TRANSFER_IN.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");
const { isFulfillmentReservationEnabled } = require("../fulfillment/reservation.service");
const stockRequestsService = require("../stock_requests/stock_requests.service");

export type CreateDispatchInput = {
  orgId: number;
  /** Stock-request path (legacy challan flow). */
  stockRequestId?: number | null;
  /** Medicine requisition pick handoff; mutually exclusive with stockRequestId. */
  medicineRequisitionId?: number | null;
  fromLocationId: number;
  toLocationId: number;
  items: Array<{ variantId: number; lotId: number; quantity: number }>;
  transport?: {
    carrierType?: string;
    vehicleNo?: string;
    driverName?: string;
    driverPhone?: string;
    trackingId?: string;
    eta?: string;
    shippingCost?: number;
    note?: string;
  };
  createdByUserId?: number;
  /** When set, validates completed pick list matches this dispatch (enterprise path). */
  pickListId?: number;
};

export type ListDispatchesFilter = {
  orgId?: number;
  status?: string;
  fromLocationId?: number;
  toLocationId?: number;
  branchId?: number;
  stockRequestId?: number;
  page?: number;
  limit?: number;
};

export type ReceiveItemInput = {
  variantId: number;
  lotId?: number;
  quantityReceived: number;
  quantityDamaged?: number;
  quantityShort?: number;
};

export async function listDispatches(filter: ListDispatchesFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filter.orgId) where.orgId = filter.orgId;
  if (filter.status) where.status = filter.status;
  if (filter.fromLocationId) where.fromLocationId = filter.fromLocationId;
  if (filter.toLocationId) where.toLocationId = filter.toLocationId;
  if (filter.stockRequestId) where.stockRequestId = filter.stockRequestId;
  if (filter.branchId) {
    where.toLocation = { branchId: filter.branchId };
  }

  const [items, total] = await Promise.all([
    prisma.stockDispatch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        stockRequest: { select: { id: true, status: true, branchId: true } },
        fromLocation: { select: { id: true, name: true, branchId: true } },
        toLocation: { select: { id: true, name: true, branchId: true } },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
      },
    }),
    prisma.stockDispatch.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDispatchById(id: number) {
  return prisma.stockDispatch.findUnique({
    where: { id },
    include: {
      org: { select: { id: true, name: true } },
      stockRequest: {
        include: {
          branch: { select: { id: true, name: true } },
          items: { include: { variant: { select: { id: true, sku: true, title: true } } } },
        },
      },
      fromLocation: { select: { id: true, name: true, type: true } },
      toLocation: { select: { id: true, name: true, type: true, branchId: true } },
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
        },
      },
      proofOfDelivery: true,
      pickList: {
        include: {
          allocationPlan: { select: { id: true, stockRequestId: true, medicineRequisitionId: true } },
        },
      },
    },
  });
}

export async function createDispatch(data: CreateDispatchInput) {
  const hasSr = data.stockRequestId != null && data.stockRequestId !== undefined;
  const hasMr = data.medicineRequisitionId != null && data.medicineRequisitionId !== undefined;
  if (hasSr === hasMr) {
    throw new Error("Provide exactly one of stockRequestId or medicineRequisitionId");
  }
  if (!data.items?.length) throw new Error("At least one item is required");

  let branchIdForToLocation: number;

  if (hasSr) {
    const request = await prisma.stockRequest.findUnique({
      where: { id: data.stockRequestId! },
      include: { items: true },
    });
    if (!request) throw new Error("Stock request not found");
    if (request.orgId !== data.orgId) throw new Error("Stock request does not belong to organization");
    if (
      ![
        "SUBMITTED",
        "OWNER_REVIEW",
        "APPROVED",
        "FULFILLED_PARTIAL",
        "FULFILLED_FULL",
        "PARTIALLY_DISPATCHED",
      ].includes(request.status)
    ) {
      throw new Error(`Request cannot be dispatched in status ${request.status}`);
    }
    branchIdForToLocation = request.branchId;
  } else {
    const mr = await prisma.medicineRequisition.findUnique({
      where: { id: data.medicineRequisitionId! },
      select: {
        orgId: true,
        branchId: true,
        status: true,
        stockDispatchId: true,
      },
    });
    if (!mr) throw new Error("Medicine requisition not found");
    if (mr.orgId !== data.orgId) throw new Error("Medicine requisition does not belong to organization");
    if (mr.stockDispatchId != null) {
      throw new Error("Medicine requisition already linked to a dispatch");
    }
    if (!["APPROVED", "PARTIALLY_APPROVED", "READY_TO_DISPATCH"].includes(mr.status)) {
      throw new Error(`Medicine requisition cannot be dispatched in status ${mr.status}`);
    }
    branchIdForToLocation = mr.branchId;
  }

  if (data.pickListId != null) {
    const pl = await prisma.pickList.findFirst({
      where: { id: data.pickListId, orgId: data.orgId, status: "COMPLETED" },
      include: {
        lines: true,
        allocationPlan: { select: { stockRequestId: true, medicineRequisitionId: true } },
      },
    });
    if (!pl) throw new Error("Completed pick list not found for organization");
    if (hasSr) {
      if (pl.allocationPlan.stockRequestId !== data.stockRequestId) {
        throw new Error("Pick list does not belong to this stock request");
      }
    } else {
      if (pl.allocationPlan.medicineRequisitionId !== data.medicineRequisitionId) {
        throw new Error("Pick list does not belong to this medicine requisition");
      }
    }
    if (pl.fromLocationId !== data.fromLocationId) {
      throw new Error("Pick list fromLocation does not match dispatch fromLocation");
    }
    const activeLines = pl.lines.filter((l) => l.quantityPicked > 0);
    const pickSlices = activeLines
      .map((l) => ({
        k: `${l.variantId}:${l.lotId}`,
        qty: l.quantityPicked,
      }))
      .sort((a, b) => a.k.localeCompare(b.k));
    const bodySlices = data.items
      .map((i) => ({ k: `${i.variantId}:${i.lotId}`, qty: i.quantity }))
      .sort((a, b) => a.k.localeCompare(b.k));
    if (pickSlices.length !== bodySlices.length) {
      throw new Error("Dispatch items do not match picked lines (partial pick: only lines with quantity > 0)");
    }
    for (let i = 0; i < pickSlices.length; i++) {
      if (pickSlices[i].k !== bodySlices[i].k || pickSlices[i].qty !== bodySlices[i].qty) {
        throw new Error("Dispatch items do not match pick list lines");
      }
    }
  }

  const toLocation = await prisma.inventoryLocation.findUnique({
    where: { id: data.toLocationId },
    select: { branchId: true },
  });
  if (!toLocation || toLocation.branchId !== branchIdForToLocation) {
    throw new Error("To location must belong to request branch");
  }

  const dispatch = await prisma.stockDispatch.create({
    data: {
      orgId: data.orgId,
      stockRequestId: hasSr ? data.stockRequestId! : null,
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      status: "CREATED",
      carrierType: data.transport?.carrierType ?? null,
      vehicleNo: data.transport?.vehicleNo ?? null,
      driverName: data.transport?.driverName ?? null,
      driverPhone: data.transport?.driverPhone ?? null,
      trackingId: data.transport?.trackingId ?? null,
      eta: data.transport?.eta ? new Date(data.transport.eta) : null,
      shippingCost: data.transport?.shippingCost != null ? data.transport.shippingCost : null,
      note: data.transport?.note ?? null,
      createdByUserId: data.createdByUserId ?? null,
      items: {
        create: data.items.map((i) => ({
          variantId: i.variantId,
          lotId: i.lotId,
          quantityDispatched: i.quantity,
          quantityReceived: 0,
          quantityDamaged: 0,
          quantityShort: 0,
        })),
      },
    },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
        },
      },
    },
  });

  if (hasMr) {
    await prisma.medicineRequisition.update({
      where: { id: data.medicineRequisitionId! },
      data: { stockDispatchId: dispatch.id },
    });
  }

  return dispatch;
}

/** Send dispatch: write TRANSFER_OUT from fromLocation, set status IN_TRANSIT. */
export async function sendDispatch(dispatchId: number, createdByUserId?: number) {
  return prisma.$transaction(async (tx: any) => {
    const dispatch = await tx.stockDispatch.findUnique({
      where: { id: dispatchId },
      include: { items: true },
    });
    if (!dispatch) throw new Error("Dispatch not found");
    if (dispatch.status !== "CREATED" && dispatch.status !== "PACKED") {
      throw new Error(`Dispatch cannot be sent in status ${dispatch.status}`);
    }

    const orgId = dispatch.orgId;
    for (const item of dispatch.items) {
      const lotBalance = await tx.stockLotBalance.findUnique({
        where: {
          locationId_lotId: { locationId: dispatch.fromLocationId, lotId: item.lotId },
        },
      });
      const onHand = lotBalance?.onHandQty ?? 0;
      const reserved = lotBalance?.reservedQty ?? 0;
      // Unreserved + reserved must cover dispatch (release then OUT consumes unreserved).
      if (onHand + reserved < item.quantityDispatched) {
        throw new Error(
          `Insufficient lot stock for variant ${item.variantId} lot ${item.lotId}. Available (unreserved+reserved): ${onHand + reserved}, Required: ${item.quantityDispatched}`
        );
      }
      const releaseQty =
        isFulfillmentReservationEnabled() ? Math.min(item.quantityDispatched, reserved) : 0;
      if (releaseQty > 0) {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId,
          locationId: dispatch.fromLocationId,
          variantId: item.variantId,
          lotId: item.lotId,
          type: "RELEASE_FULFILLMENT_RESERVE",
          quantityDelta: -releaseQty,
          refType: "DISPATCH",
          refId: String(dispatchId),
          createdByUserId: createdByUserId ?? undefined,
        });
      }
      await ledgerService.recordLedgerEntryInTx(tx, {
        orgId,
        locationId: dispatch.fromLocationId,
        variantId: item.variantId,
        lotId: item.lotId,
        type: "TRANSFER_OUT",
        quantityDelta: -item.quantityDispatched,
        refType: "DISPATCH",
        refId: String(dispatchId),
        createdByUserId: createdByUserId ?? undefined,
      });
    }

    const updated = await tx.stockDispatch.update({
      where: { id: dispatchId },
      data: {
        status: "IN_TRANSIT",
        inTransitAt: new Date(),
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
      },
    });

    const request =
      dispatch.stockRequestId != null
        ? await tx.stockRequest.findUnique({
            where: { id: dispatch.stockRequestId },
            include: { items: true, dispatches: { select: { id: true }, where: { status: { not: "CREATED" } } } },
          })
        : null;
    if (request) {
      const totalRequested = request.items.reduce((s: number, i: any) => s + i.requestedQty, 0);
      const totalDispatched = await tx.stockDispatchItem.aggregate({
        where: { stockDispatch: { stockRequestId: request.id } },
        _sum: { quantityDispatched: true },
      });
      const sum = totalDispatched._sum?.quantityDispatched ?? 0;
      const newStatus = sum >= totalRequested ? "DISPATCHED" : "PARTIALLY_DISPATCHED";
      await tx.stockRequest.update({
        where: { id: request.id },
        data: { status: newStatus },
      });
    }

    const linkedMr = await tx.medicineRequisition.findFirst({
      where: { stockDispatchId: dispatchId },
    });
    if (linkedMr && ["APPROVED", "PARTIALLY_APPROVED", "READY_TO_DISPATCH"].includes(linkedMr.status)) {
      await tx.medicineRequisition.update({
        where: { id: linkedMr.id },
        data: { status: "DISPATCHED" },
      });
    }

    return updated;
  });
}

export async function updateDispatchStatus(
  dispatchId: number,
  status: "PACKED" | "IN_TRANSIT" | "DELIVERED",
  userId?: number
) {
  const dispatch = await prisma.stockDispatch.findUnique({
    where: { id: dispatchId },
    select: { status: true },
  });
  if (!dispatch) throw new Error("Dispatch not found");
  const allowed: Record<string, string[]> = {
    CREATED: ["PACKED"],
    PACKED: ["IN_TRANSIT"],
    IN_TRANSIT: ["DELIVERED"],
  };
  const next = allowed[dispatch.status];
  if (!next || !next.includes(status)) {
    throw new Error(`Cannot set status ${status} from ${dispatch.status}`);
  }

  const data: any = { status };
  if (status === "PACKED") data.packedAt = new Date();
  if (status === "IN_TRANSIT") data.inTransitAt = new Date();
  if (status === "DELIVERED") data.deliveredAt = new Date();

  return prisma.stockDispatch.update({
    where: { id: dispatchId },
    data,
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
        },
      },
    },
  });
}

/**
 * Receive dispatch at branch: create GRN (linked to dispatch), write TRANSFER_IN (and DAMAGE/EXPIRED for discrepancies).
 */
export async function receiveDispatch(
  dispatchId: number,
  data: {
    items: ReceiveItemInput[];
    notes?: string;
    createdByUserId?: number;
    idempotencyKey?: string;
  }
) {
  return prisma.$transaction(async (tx: any) => {
    const dispatch = await tx.stockDispatch.findUnique({
      where: { id: dispatchId },
      include: { items: true },
    });
    if (!dispatch) throw new Error("Dispatch not found");
    if (dispatch.status !== "IN_TRANSIT") {
      throw new Error(`Dispatch can only be received when IN_TRANSIT. Current: ${dispatch.status}`);
    }

    if (data.idempotencyKey?.trim()) {
      const existing = await tx.grn.findFirst({
        where: { stockDispatchId: dispatchId, idempotencyKey: data.idempotencyKey.trim() },
        select: { id: true },
      });
      if (existing) throw new Error("Duplicate receive request (idempotency key)");
    }

    const receiveItems = data.items?.length
      ? data.items
      : dispatch.items.map((i: any) => ({
          variantId: i.variantId,
          lotId: i.lotId,
          quantityReceived: i.quantityDispatched,
          quantityDamaged: 0,
          quantityShort: 0,
        }));

    const orgId = dispatch.orgId;
    // Additive validation: received + damaged + short must not exceed dispatched per line; partial receive allowed.
    for (const rec of receiveItems) {
      const line = dispatch.items.find(
        (i: any) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
      );
      if (!line) throw new Error(`Item variant ${rec.variantId} not found in dispatch`);
      const qtyReceived = Math.max(0, rec.quantityReceived ?? 0);
      const qtyDamaged = Math.max(0, rec.quantityDamaged ?? 0);
      const qtyShort = Math.max(0, rec.quantityShort ?? 0);
      const total = qtyReceived + qtyDamaged + qtyShort;
      if (total > line.quantityDispatched) {
        throw new Error(`Received total ${total} cannot exceed dispatched ${line.quantityDispatched} for variant ${rec.variantId}`);
      }
      const newReceived = line.quantityReceived + qtyReceived;
      const newDamaged = line.quantityDamaged + qtyDamaged;
      const newShort = line.quantityShort + qtyShort;
      const newTotal = newReceived + newDamaged + newShort;
      if (newTotal > line.quantityDispatched) {
        throw new Error(`Running total would exceed dispatched for variant ${rec.variantId}`);
      }

      await tx.stockDispatchItem.update({
        where: { id: line.id },
        data: {
          quantityReceived: newReceived,
          quantityDamaged: newDamaged,
          quantityShort: newShort,
        },
      });

      const lotId = rec.lotId ?? line.lotId;
      if (qtyReceived > 0) {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId,
          locationId: dispatch.toLocationId,
          variantId: rec.variantId,
          lotId: lotId ?? undefined,
          type: "TRANSFER_IN",
          quantityDelta: qtyReceived,
          refType: "DISPATCH",
          refId: String(dispatchId),
          createdByUserId: data.createdByUserId,
        });
      }
      if (qtyDamaged > 0) {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId,
          locationId: dispatch.toLocationId,
          variantId: rec.variantId,
          lotId: lotId ?? undefined,
          type: "DAMAGE",
          quantityDelta: -qtyDamaged,
          refType: "DISPATCH",
          refId: String(dispatchId),
          createdByUserId: data.createdByUserId,
        });
      }
    }

    const grn = await tx.grn.create({
      data: {
        orgId,
        vendorId: null,
        stockDispatchId: dispatchId,
        idempotencyKey: data.idempotencyKey?.trim() || null,
        locationId: dispatch.toLocationId,
        status: "RECEIVED",
        notes: data.notes ?? null,
        receivedAt: new Date(),
        receivedByUserId: data.createdByUserId ?? null,
        lines: {
          create: receiveItems.map((r: ReceiveItemInput) => {
            const line = dispatch.items.find((i: any) => i.variantId === r.variantId && (r.lotId == null || r.lotId === i.lotId));
            return {
              variantId: r.variantId,
              quantity: Math.max(0, r.quantityReceived ?? 0),
              quantityDamaged: Math.max(0, r.quantityDamaged ?? 0),
              quantityShort: Math.max(0, r.quantityShort ?? 0),
              lotId: r.lotId ?? line?.lotId ?? null,
            };
          }),
        },
      },
      include: { lines: true },
    });

    const allReceived = await (async () => {
      const items = await tx.stockDispatchItem.findMany({ where: { stockDispatchId: dispatchId } });
      return items.every((i: any) => i.quantityReceived + i.quantityDamaged + i.quantityShort >= i.quantityDispatched);
    })();

    if (allReceived) {
      await tx.stockDispatch.update({
        where: { id: dispatchId },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }
    const updatedDispatch = await tx.stockDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
      },
    })!;

    if (dispatch.stockRequestId != null) {
      await stockRequestsService.markStockRequestStatusFromDispatchReceive(tx, dispatch.stockRequestId);
    }

    const mrLinked = await tx.medicineRequisition.findFirst({ where: { stockDispatchId: dispatchId } });
    if (mrLinked) {
      await tx.medicineRequisition.update({
        where: { id: mrLinked.id },
        data: {
          status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
          ...(allReceived ? { completedAt: new Date() } : {}),
        },
      });
    }

    return { dispatch: updatedDispatch, grn };
  });
}

/** Incoming dispatches for a branch (toLocation.branchId = branchId), status IN_TRANSIT. */
export async function createDispatchDiscrepancy(data: {
  orgId: number;
  stockDispatchId: number;
  variantId: number;
  lotId?: number | null;
  reasonCode: string;
  quantity: number;
  notes?: string | null;
}) {
  const dispatch = await prisma.stockDispatch.findFirst({
    where: { id: data.stockDispatchId, orgId: data.orgId },
    select: { id: true },
  });
  if (!dispatch) throw new Error("Dispatch not found for organization");

  return prisma.stockDispatchDiscrepancy.create({
    data: {
      orgId: data.orgId,
      stockDispatchId: data.stockDispatchId,
      variantId: data.variantId,
      lotId: data.lotId ?? null,
      reasonCode: data.reasonCode,
      quantity: data.quantity,
      notes: data.notes ?? null,
    },
  });
}

export async function listDispatchDiscrepancies(stockDispatchId: number, orgId: number) {
  return prisma.stockDispatchDiscrepancy.findMany({
    where: { stockDispatchId, orgId },
    orderBy: { id: "desc" },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      lot: { select: { id: true, lotCode: true } },
    },
  });
}

export async function resolveDispatchDiscrepancy(
  discrepancyId: number,
  orgId: number,
  data: { resolutionNote?: string | null; resolvedByUserId: number }
) {
  const row = await prisma.stockDispatchDiscrepancy.findFirst({
    where: { id: discrepancyId, orgId },
  });
  if (!row) throw new Error("Discrepancy not found");
  return prisma.stockDispatchDiscrepancy.update({
    where: { id: discrepancyId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: data.resolvedByUserId,
      resolutionNote: data.resolutionNote ?? null,
    },
  });
}

export async function getIncomingDispatchesForBranch(branchId: number, orgId?: number) {
  const where: any = {
    toLocation: { branchId },
    status: "IN_TRANSIT",
  };
  if (orgId) where.orgId = orgId;
  return prisma.stockDispatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
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
  });
}
