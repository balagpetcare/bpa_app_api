/**
 * Stock Dispatch (Challan/DO) service.
 * Create dispatch from fulfill plan; send = ledger TRANSFER_OUT; receive = GRN + ledger TRANSFER_IN.
 */
import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  assertReceiveItemsHaveDiscrepancyNotes,
  validateReceiveBatchAgainstRemaining,
} from "./dispatchReceivePartition";

export {
  assertReceiveItemsHaveDiscrepancyNotes,
  DISPATCH_RECEIVE_LINE_DISCREPANCY_REASON_CODES,
  validateReceiveBatchAgainstRemaining,
} from "./dispatchReceivePartition";
const ledgerService = require("../inventory/ledger.service");
const { isFulfillmentReservationEnabled } = require("../fulfillment/reservation.service");
const stockRequestsService = require("../stock_requests/stock_requests.service");
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";

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
  /** Physically received beyond remaining envelope; not posted to stock (logged as dispatch discrepancy on confirm). */
  excessQty?: number;
  /** Optional disposition / follow-up (stored on session line; appended to discrepancy notes when posted). */
  followUpNote?: string | null;
  /** Optional line-level reason (e.g. session verification); stored on dispatch discrepancy rows. */
  reasonCode?: string | null;
  lineNote?: string | null;
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
      createdBy: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { email: true } },
        },
      },
      grns: { orderBy: { id: "desc" }, take: 3, select: { id: true, status: true, receivedAt: true } },
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
      dispatchReceiveSession: {
        include: {
          lines: {
            include: {
              stockDispatchItem: {
                include: {
                  variant: { select: { id: true, sku: true, title: true } },
                  lot: { select: { id: true, lotCode: true, expDate: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Default receive location for a branch (stock request / MR destination).
 * Prefers retail-facing types when multiple active locations exist.
 */
export async function resolveDefaultReceiveLocationIdForBranch(
  branchId: number,
  orgId: number,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx ?? prisma;
  const locs = await db.inventoryLocation.findMany({
    where: { branchId, isActive: true, branch: { orgId } },
    select: { id: true, type: true },
    orderBy: { id: "asc" },
  });
  if (!locs.length) {
    const br = await db.branch.findFirst({ where: { id: branchId, orgId }, select: { name: true } });
    const label = br?.name ? `${branchId} (${br.name})` : String(branchId);
    throw new Error(
      `No active inventory location for destination branch ${label}. In Owner → Branches, create at least one active inventory location for this branch before dispatch.`
    );
  }
  const preferredOrder: string[] = [
    "BRANCH_STORE",
    "PHARMACY",
    "CLINIC_STORE",
    "SHOP",
    "STAGING",
    "CENTRAL_WAREHOUSE",
    "CLINIC",
    "ONLINE_HUB",
    "DAMAGE_AREA",
    "RETURN_AREA",
    "QUARANTINE",
  ];
  for (const t of preferredOrder) {
    const hit = locs.find((l) => String(l.type) === t);
    if (hit) return hit.id;
  }
  return locs[0].id;
}

/**
 * Create a stock dispatch (SR or MR path). Pass `tx` when called inside an interactive transaction
 * so dispatch + MR linkage roll back with the caller (e.g. pick handoff).
 */
export async function createDispatch(
  data: CreateDispatchInput,
  options?: { tx?: Prisma.TransactionClient }
) {
  const db: Prisma.TransactionClient | typeof prisma = options?.tx ?? prisma;

  const hasSr = data.stockRequestId != null && data.stockRequestId !== undefined;
  const hasMr = data.medicineRequisitionId != null && data.medicineRequisitionId !== undefined;
  if (hasSr === hasMr) {
    throw new Error("Provide exactly one of stockRequestId or medicineRequisitionId");
  }
  if (!data.items?.length) throw new Error("At least one item is required");

  let branchIdForToLocation: number;

  /** SR statuses allowed for legacy / non-pick dispatch creation */
  const SR_DISPATCH_BASE = [
    "SUBMITTED",
    "OWNER_REVIEW",
    "APPROVED",
    "FULFILLED_PARTIAL",
    "FULFILLED_FULL",
    "PARTIALLY_DISPATCHED",
  ] as const;
  /** When validating against a completed pick list (allocation handoff), allow receive-stage statuses that blocked outbound challan creation */
  const SR_DISPATCH_WITH_PICK_HANDOFF = [
    ...SR_DISPATCH_BASE,
    "RECEIVED_FULL",
    "RECEIVED_PARTIAL",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
  ] as const;

  if (hasSr) {
    const request = await db.stockRequest.findUnique({
      where: { id: data.stockRequestId! },
      include: { items: true },
    });
    if (!request) throw new Error("Stock request not found");
    if (request.orgId !== data.orgId) throw new Error("Stock request does not belong to organization");
    const allowedSrStatuses = (data.pickListId != null ? SR_DISPATCH_WITH_PICK_HANDOFF : SR_DISPATCH_BASE) as readonly string[];
    if (!allowedSrStatuses.includes(request.status)) {
      throw new Error(`Request cannot be dispatched in status ${request.status}`);
    }
    branchIdForToLocation = request.branchId;
  } else {
    const mr = await db.medicineRequisition.findUnique({
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
    const pl = await db.pickList.findFirst({
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

  const toLocation = await db.inventoryLocation.findUnique({
    where: { id: data.toLocationId },
    select: { branchId: true },
  });
  if (!toLocation || toLocation.branchId !== branchIdForToLocation) {
    throw new Error("To location must belong to request branch");
  }

  const dispatch = await db.stockDispatch.create({
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
    await db.medicineRequisition.update({
      where: { id: data.medicineRequisitionId! },
      data: { stockDispatchId: dispatch.id },
    });
  }

  return dispatch;
}

/** Send dispatch: write TRANSFER_OUT from fromLocation, set status IN_TRANSIT. */
export async function sendDispatch(dispatchId: number, createdByUserId?: number) {
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw(Prisma.sql`SELECT id FROM stock_dispatches WHERE id = ${dispatchId} FOR UPDATE`);

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
 * Core receive posting inside an existing transaction (row-locked dispatch).
 * Used by legacy immediate receive and by controlled confirm (same atomic unit as session update).
 */
export async function receiveDispatchLedgerInTx(
  tx: any,
  dispatchId: number,
  data: {
    items: ReceiveItemInput[];
    notes?: string;
    createdByUserId?: number;
    idempotencyKey?: string;
  },
  ledgerOpts?: { relaxRemainingPartition?: boolean }
) {
  await tx.$executeRaw(Prisma.sql`SELECT id FROM stock_dispatches WHERE id = ${dispatchId} FOR UPDATE`);

  const dispatch = await tx.stockDispatch.findUnique({
    where: { id: dispatchId },
    include: { items: true },
  });
  if (!dispatch) throw new Error("Dispatch not found");
  if (dispatch.status !== "IN_TRANSIT") {
    throw new Error(`Dispatch can only be received when IN_TRANSIT. Current: ${dispatch.status}`);
  }

  const destLocation = await tx.inventoryLocation.findUnique({
    where: { id: dispatch.toLocationId },
    select: { branchId: true },
  });
  if (!destLocation?.branchId) {
    throw new Error("Dispatch destination location has no branch");
  }

  if (data.idempotencyKey?.trim()) {
    const existing = await tx.grn.findFirst({
      where: { stockDispatchId: dispatchId, idempotencyKey: data.idempotencyKey.trim() },
      select: { id: true },
    });
    if (existing) {
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
      });
      const grn = await tx.grn.findFirst({
        where: { id: existing.id },
        include: { lines: true },
      });
      return { dispatch: updatedDispatch, grn };
    }
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
    const relaxPartition = ledgerOpts?.relaxRemainingPartition === true;
    for (const rec of receiveItems) {
      const line = dispatch.items.find(
        (i: any) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
      );
      if (!line) throw new Error(`Item variant ${rec.variantId} not found in dispatch`);
      const partitionErr = validateReceiveBatchAgainstRemaining(line, rec, {
        relaxRemainingPartition: relaxPartition,
      });
      if (partitionErr) throw new Error(partitionErr);
      const qtyReceived = Math.max(0, rec.quantityReceived ?? 0);
      const qtyDamaged = Math.max(0, rec.quantityDamaged ?? 0);
      const qtyShort = Math.max(0, rec.quantityShort ?? 0);
      const newReceived = line.quantityReceived + qtyReceived;
      const newDamaged = line.quantityDamaged + qtyDamaged;
      const newShort = line.quantityShort + qtyShort;
      const newTotal = newReceived + newDamaged + newShort;
      if (newTotal > line.quantityDispatched) {
        throw new Error(`Running total would exceed dispatched for variant ${rec.variantId}`);
      }
    }

    assertReceiveItemsHaveDiscrepancyNotes(dispatch.items, receiveItems, {
      relaxRemainingPartition: relaxPartition,
    });

    for (const rec of receiveItems) {
      const line = dispatch.items.find(
        (i: any) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
      );
      if (!line) throw new Error(`Item variant ${rec.variantId} not found in dispatch`);
      const qtyReceived = Math.max(0, rec.quantityReceived ?? 0);
      const qtyDamaged = Math.max(0, rec.quantityDamaged ?? 0);
      const qtyShort = Math.max(0, rec.quantityShort ?? 0);
      const newReceived = line.quantityReceived + qtyReceived;
      const newDamaged = line.quantityDamaged + qtyDamaged;
      const newShort = line.quantityShort + qtyShort;

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

        try {
          const vaccineBridge = require("../clinic/vaccineInventoryBridge.service");
          await vaccineBridge.mirrorDispatchReceiveLineToClinicalStock(tx, {
            orgId,
            destBranchId: destLocation.branchId,
            stockDispatchItemId: line.id,
            productVariantId: rec.variantId,
            stockLotId: lotId,
            quantityReceived: qtyReceived,
            actorUserId: data.createdByUserId ?? null,
          });
        } catch (mirrorErr: any) {
          console.warn("[dispatch.clinicalMirror]", dispatchId, line.id, mirrorErr?.message || mirrorErr);
        }
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

      const discNote =
        rec.lineNote != null && String(rec.lineNote).trim() ? String(rec.lineNote).trim() : null;
      const discRc =
        rec.reasonCode != null && String(rec.reasonCode).trim()
          ? String(rec.reasonCode).trim().slice(0, 64)
          : null;
      if (qtyDamaged > 0) {
        await tx.stockDispatchDiscrepancy.create({
          data: {
            orgId,
            stockDispatchId: dispatchId,
            variantId: rec.variantId,
            lotId: lotId ?? null,
            reasonCode: discRc || "DAMAGE",
            quantity: qtyDamaged,
            notes: discNote,
          },
        });
      }
      if (qtyShort > 0) {
        await tx.stockDispatchDiscrepancy.create({
          data: {
            orgId,
            stockDispatchId: dispatchId,
            variantId: rec.variantId,
            lotId: lotId ?? null,
            reasonCode: discRc || "SHORT",
            quantity: qtyShort,
            notes: discNote,
          },
        });
      }
      const qtyExcess = Math.max(0, rec.excessQty ?? 0);
      if (qtyExcess > 0) {
        const follow = rec.followUpNote != null && String(rec.followUpNote).trim() ? String(rec.followUpNote).trim() : "";
        const combinedNotes = [discNote, follow].filter(Boolean).join("\n\n") || null;
        await tx.stockDispatchDiscrepancy.create({
          data: {
            orgId,
            stockDispatchId: dispatchId,
            variantId: rec.variantId,
            lotId: lotId ?? null,
            reasonCode: discRc || "OVER_DELIVERED",
            quantity: qtyExcess,
            notes: combinedNotes,
          },
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
}

/**
 * Receive dispatch at branch: create GRN (linked to dispatch), write TRANSFER_IN (and DAMAGE for discrepancies).
 * Ledger posting path — use after branch verification/manager confirmation when using controlled receive.
 */
export async function receiveDispatchLegacyImmediate(
  dispatchId: number,
  data: {
    items: ReceiveItemInput[];
    notes?: string;
    createdByUserId?: number;
    idempotencyKey?: string;
  }
) {
  return prisma.$transaction((tx: any) =>
    receiveDispatchLedgerInTx(tx, dispatchId, data, { relaxRemainingPartition: true })
  );
}

export type ReceiveDispatchMode = "legacy_immediate" | "verify" | "submit" | "confirm";

/** Save proposed receive quantities (no ledger). */
export async function saveDispatchReceiveVerification(
  dispatchId: number,
  data: {
    items: ReceiveItemInput[];
    notes?: string;
    createdByUserId?: number;
  },
  opts?: { preserveSessionStatus?: boolean }
) {
  const dispatch = await prisma.stockDispatch.findUnique({
    where: { id: dispatchId },
    include: { items: true },
  });
  if (!dispatch) throw new Error("Dispatch not found");
  if (dispatch.status !== "IN_TRANSIT") {
    throw new Error(`Dispatch can only be verified when IN_TRANSIT. Current: ${dispatch.status}`);
  }

  const receiveItems: ReceiveItemInput[] = data.items?.length
    ? data.items
    : dispatch.items.map((i: any) => ({
        variantId: i.variantId,
        lotId: i.lotId,
        quantityReceived: i.quantityDispatched,
        quantityDamaged: 0,
        quantityShort: 0,
      }));

  for (const rec of receiveItems) {
    const line = dispatch.items.find(
      (i: any) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
    );
    if (!line) throw new Error(`Item variant ${rec.variantId} not found in dispatch`);
    const partitionErr = validateReceiveBatchAgainstRemaining(line, rec, { relaxRemainingPartition: false });
    if (partitionErr) throw new Error(partitionErr);
    const qtyReceived = Math.max(0, rec.quantityReceived ?? 0);
    const qtyDamaged = Math.max(0, rec.quantityDamaged ?? 0);
    const qtyShort = Math.max(0, rec.quantityShort ?? 0);
    const newReceived = line.quantityReceived + qtyReceived;
    const newDamaged = line.quantityDamaged + qtyDamaged;
    const newShort = line.quantityShort + qtyShort;
    const newTotal = newReceived + newDamaged + newShort;
    if (newTotal > line.quantityDispatched) {
      throw new Error(`Running verified total would exceed dispatched for variant ${rec.variantId}`);
    }
  }

  assertReceiveItemsHaveDiscrepancyNotes(dispatch.items, receiveItems, { relaxRemainingPartition: false });

  return prisma.$transaction(async (tx: any) => {
    const updateData: Record<string, unknown> = {
      notes: data.notes ?? null,
      verifiedAt: new Date(),
      verifiedByUserId: data.createdByUserId ?? null,
    };
    if (!opts?.preserveSessionStatus) {
      updateData.status = "DRAFT";
    }

    const session = await tx.dispatchReceiveSession.upsert({
      where: { stockDispatchId: dispatchId },
      create: {
        orgId: dispatch.orgId,
        stockDispatchId: dispatchId,
        status: "DRAFT",
        notes: data.notes ?? null,
        verifiedAt: new Date(),
        verifiedByUserId: data.createdByUserId ?? null,
      },
      update: updateData as any,
    });

    await tx.dispatchReceiveSessionLine.deleteMany({ where: { sessionId: session.id } });

    for (const rec of receiveItems) {
      const line = dispatch.items.find(
        (i: any) => i.variantId === rec.variantId && (rec.lotId == null || rec.lotId === i.lotId)
      )!;
      await tx.dispatchReceiveSessionLine.create({
        data: {
          sessionId: session.id,
          stockDispatchItemId: line.id,
          quantityReceived: Math.max(0, rec.quantityReceived ?? 0),
          quantityDamaged: Math.max(0, rec.quantityDamaged ?? 0),
          quantityShort: Math.max(0, rec.quantityShort ?? 0),
          excessQty: Math.max(0, rec.excessQty ?? 0),
          reasonCode:
            rec.reasonCode != null && String(rec.reasonCode).trim()
              ? String(rec.reasonCode).trim().slice(0, 64)
              : null,
          lineNote: rec.lineNote != null && String(rec.lineNote).trim() ? String(rec.lineNote).trim() : null,
          followUpNote:
            rec.followUpNote != null && String(rec.followUpNote).trim() ? String(rec.followUpNote).trim() : null,
        },
      });
    }

    await logWarehouseAudit({
      orgId: dispatch.orgId,
      warehouseId: null,
      category: "OPERATIONS",
      action: "DISPATCH_RECEIVE_VERIFICATION_SAVED",
      entityType: "DispatchReceiveSession",
      entityId: String(session.id),
      metadata: { stockDispatchId: dispatchId },
      actorUserId: data.createdByUserId ?? null,
    });

    return tx.dispatchReceiveSession.findUnique({
      where: { id: session.id },
      include: {
        lines: {
          include: {
            stockDispatchItem: {
              include: {
                variant: { select: { id: true, sku: true, title: true } },
                lot: { select: { id: true, lotCode: true, expDate: true } },
              },
            },
          },
        },
      },
    });
  });
}

export async function submitDispatchReceiveSessionForConfirmation(dispatchId: number, userId: number) {
  const session = await prisma.dispatchReceiveSession.findUnique({
    where: { stockDispatchId: dispatchId },
  });
  if (!session) throw new Error("No receive verification saved for this dispatch yet");
  if (session.status === "AWAITING_CONFIRMATION") {
    return session;
  }
  if (session.status !== "DRAFT") {
    throw new Error(`Submit requires session in DRAFT (current: ${session.status})`);
  }
  const updated = await prisma.dispatchReceiveSession.update({
    where: { id: session.id },
    data: {
      status: "AWAITING_CONFIRMATION",
      submittedAt: new Date(),
      submittedByUserId: userId,
    },
  });
  await logWarehouseAudit({
    orgId: session.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "DISPATCH_RECEIVE_SUBMITTED_FOR_CONFIRMATION",
    entityType: "DispatchReceiveSession",
    entityId: String(session.id),
    metadata: { stockDispatchId: dispatchId },
    actorUserId: userId,
  });
  try {
    const { notifyDispatchReceiveSubmittedForConfirmation } = require("../../services/warehouseOpsNotifications.service");
    void notifyDispatchReceiveSubmittedForConfirmation({
      orgId: session.orgId,
      stockDispatchId: dispatchId,
      actorUserId: userId,
    });
  } catch (_) {
    /* optional */
  }
  return updated;
}

export async function confirmDispatchReceiveFromSession(
  dispatchId: number,
  data: { createdByUserId?: number; idempotencyKey?: string; notes?: string; items?: ReceiveItemInput[] },
  options?: { allowConfirmFromDraft?: boolean }
) {
  const hasPayloadItems = Array.isArray(data.items) && data.items.length > 0;

  let session = await prisma.dispatchReceiveSession.findUnique({
    where: { stockDispatchId: dispatchId },
    include: {
      lines: {
        include: {
          stockDispatchItem: true,
        },
      },
    },
  });

  const priorSessionStatus = session?.status;
  const needsHydrateFromBody =
    hasPayloadItems &&
    (!session ||
      !session.lines.length ||
      (session.status === "DRAFT" && options?.allowConfirmFromDraft === true) ||
      session.status === "AWAITING_CONFIRMATION");

  if (needsHydrateFromBody && data.items) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[dispatch.receive.confirm] hydrating session from request items", {
        dispatchId,
        itemCount: data.items.length,
        priorSessionStatus: priorSessionStatus ?? "(none)",
      });
    }
    const preserveSubmit = priorSessionStatus === "AWAITING_CONFIRMATION" && hasPayloadItems;
    await saveDispatchReceiveVerification(
      dispatchId,
      {
        items: data.items,
        notes: data.notes,
        createdByUserId: data.createdByUserId,
      },
      { preserveSessionStatus: preserveSubmit }
    );
    session = await prisma.dispatchReceiveSession.findUnique({
      where: { stockDispatchId: dispatchId },
      include: {
        lines: {
          include: {
            stockDispatchItem: true,
          },
        },
      },
    });
  }

  if (!session) {
    throw new Error(
      "No receive session to confirm. Save verification first, or include receive line items in the confirm request."
    );
  }
  if (session.status === "POSTED" || session.status === "CANCELLED") {
    throw new Error(`Cannot confirm in status ${session.status}`);
  }
  if (session.status === "DRAFT" && !options?.allowConfirmFromDraft) {
    throw new Error(
      "Submit branch verification for manager confirmation first (POST .../receive-submit), or use legacy receive with branch manager permission."
    );
  }
  if (!session.lines.length) {
    throw new Error(
      "Receive session has no lines. Save verification first, or include receive line items in the confirm request."
    );
  }

  const items: ReceiveItemInput[] = session.lines.map((l: any) => ({
    variantId: l.stockDispatchItem.variantId,
    lotId: l.stockDispatchItem.lotId,
    quantityReceived: l.quantityReceived,
    quantityDamaged: l.quantityDamaged,
    quantityShort: l.quantityShort,
    excessQty: l.excessQty ?? 0,
    reasonCode: l.reasonCode ?? undefined,
    lineNote: l.lineNote ?? undefined,
    followUpNote: l.followUpNote ?? undefined,
  }));

  /** Ledger + GRN + session state in one transaction (no committed receive without session update). */
  const result = await prisma.$transaction(async (tx: any) => {
    // PostgreSQL column is camelCase "stockDispatchId" (Prisma @@map table "dispatch_receive_sessions").
    await tx.$executeRaw(
      Prisma.sql`SELECT id FROM "dispatch_receive_sessions" WHERE "stockDispatchId" = ${dispatchId} FOR UPDATE`
    );
    const locked = await tx.dispatchReceiveSession.findUnique({
      where: { stockDispatchId: dispatchId },
      select: { id: true, status: true, orgId: true, notes: true },
    });
    if (!locked) throw new Error("No receive session to confirm");
    if (locked.status === "POSTED" || locked.status === "CANCELLED") {
      throw new Error(`Cannot confirm in status ${locked.status}`);
    }

    const receiveResult = await receiveDispatchLedgerInTx(
      tx,
      dispatchId,
      {
        items,
        notes: data.notes ?? session.notes ?? undefined,
        createdByUserId: data.createdByUserId,
        idempotencyKey: data.idempotencyKey,
      },
      { relaxRemainingPartition: false }
    );

    const allReceived = receiveResult.dispatch?.status === "DELIVERED";

    await tx.dispatchReceiveSession.update({
      where: { id: locked.id },
      data: {
        status: allReceived ? "POSTED" : "DRAFT",
        confirmedAt: new Date(),
        confirmedByUserId: data.createdByUserId ?? null,
        idempotencyKey: data.idempotencyKey?.trim() || null,
      },
    });

    if (!allReceived) {
      await tx.dispatchReceiveSessionLine.deleteMany({ where: { sessionId: locked.id } });
    }

    return receiveResult;
  });

  await logWarehouseAudit({
    orgId: session.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "DISPATCH_RECEIVE_CONFIRMED",
    entityType: "DispatchReceiveSession",
    entityId: String(session.id),
    metadata: { stockDispatchId: dispatchId, allReceived: result.dispatch?.status === "DELIVERED" },
    actorUserId: data.createdByUserId ?? null,
  });

  return result;
}

/** Cancel a DRAFT DispatchReceiveSession (branch inbound draft only). */
export async function cancelDispatchReceiveSession(dispatchId: number, actorUserId?: number | null) {
  const session = await prisma.dispatchReceiveSession.findUnique({
    where: { stockDispatchId: dispatchId },
  });
  if (!session) return { ok: false as const, code: "NO_SESSION" as const };
  if (session.status !== "DRAFT") {
    throw new Error(`Only DRAFT receive sessions can be cancelled (current: ${session.status})`);
  }
  await prisma.dispatchReceiveSession.update({
    where: { id: session.id },
    data: { status: "CANCELLED" },
  });
  await logWarehouseAudit({
    orgId: session.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "DISPATCH_RECEIVE_SESSION_CANCELLED",
    entityType: "DispatchReceiveSession",
    entityId: String(session.id),
    metadata: { stockDispatchId: dispatchId },
    actorUserId: actorUserId ?? null,
  });
  return { ok: true as const, sessionId: session.id };
}

/**
 * Controlled receive entry point.
 * - `legacy_immediate` — post TRANSFER_IN immediately (manager / backward compatible).
 * - `verify` — draft session only.
 * - `submit` — AWAITING_CONFIRMATION.
 * - `confirm` — post ledger from saved session.
 */
export async function receiveDispatch(
  dispatchId: number,
  data: {
    items?: ReceiveItemInput[];
    notes?: string;
    createdByUserId?: number;
    idempotencyKey?: string;
  },
  options?: { mode?: ReceiveDispatchMode; allowConfirmFromDraft?: boolean }
) {
  const mode = options?.mode ?? "legacy_immediate";
  const sessionOnly = String(process.env.ENTERPRISE_DISPATCH_RECEIVE_SESSION_ONLY || "").toLowerCase() === "true";
  if (sessionOnly && mode === "legacy_immediate") {
    throw new Error(
      "Dispatch receive must use verify → submit → confirm (ENTERPRISE_DISPATCH_RECEIVE_SESSION_ONLY=true). Immediate ledger post is disabled."
    );
  }
  if (mode === "verify") {
    return saveDispatchReceiveVerification(dispatchId, {
      items: data.items ?? [],
      notes: data.notes,
      createdByUserId: data.createdByUserId,
    });
  }
  if (mode === "submit") {
    if (data.createdByUserId == null) {
      throw new Error("createdByUserId is required for submit");
    }
    return submitDispatchReceiveSessionForConfirmation(dispatchId, data.createdByUserId);
  }
  if (mode === "confirm") {
    return confirmDispatchReceiveFromSession(dispatchId, data, {
      allowConfirmFromDraft: options?.allowConfirmFromDraft === true,
    });
  }
  return receiveDispatchLegacyImmediate(dispatchId, {
    items: data.items ?? [],
    notes: data.notes,
    createdByUserId: data.createdByUserId,
    idempotencyKey: data.idempotencyKey,
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
