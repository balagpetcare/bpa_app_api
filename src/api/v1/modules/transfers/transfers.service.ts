import prisma from "../../../../infrastructure/db/prismaClient";
import { assertLegacyStockTransferAllowedForDraftPayload } from "../../services/legacyFulfillmentGuard.service";
const ledgerService = require("../inventory/ledger.service");

/**
 * @deprecated LEGACY TRANSFER MODULE
 *
 * ===============================================================================
 * DEPRECATION NOTICE: This StockTransfer module is superseded by StockDispatch.
 * ===============================================================================
 *
 * CANONICAL FLOW (use this instead):
 *   StockRequest → AllocationPlan → PickList → StockDispatch
 *   → sendDispatch (TRANSFER_OUT) → Branch Receive Session → Manager Confirm → Ledger Update
 *
 * WHY DEPRECATED:
 *   - StockDispatch integrates with controlled receiving (manager confirmation)
 *   - StockDispatch supports transport/challan metadata and proof of delivery
 *   - StockDispatch has full audit trail via DispatchReceiveSession
 *   - StockDispatch integrates with allocation plans and pick lists
 *
 * MIGRATION PATH:
 *   - Create a StockRequest (or use direct dispatch for admin override)
 *   - Use fulfillment module to create AllocationPlan + PickList
 *   - Create StockDispatch via pick handoff or direct createDispatch
 *   - Use sendDispatch for TRANSFER_OUT
 *   - Destination receives via receiveDispatch with controlled session
 *
 * DO NOT CREATE NEW INTEGRATIONS WITH THIS MODULE.
 * Existing data remains readable; new transfers should use StockDispatch.
 *
 * See: docs/VENDOR_RECEIVE_BRANCH_CONFIRMATION_PRICING_GOVERNANCE_PLAN.md
 */

/**
 * @deprecated Use StockDispatch flow instead.
 * Create a stock transfer (draft).
 * Items may be lot-backed (lotId set) or non-lot aggregate (lotId null) when policy allows.
 */
async function createTransfer(data: {
  fromLocationId: number;
  toLocationId: number;
  items: Array<{
    variantId: number;
    quantity: number;
    lotId: number | null;
    stockRequestItemId?: number | null;
  }>;
  createdByUserId?: number;
}) {
  const lineIds = data.items
    .map((i) => i.stockRequestItemId)
    .filter((x): x is number => typeof x === "number" && x > 0);
  await assertLegacyStockTransferAllowedForDraftPayload({
    stockRequestId: null,
    stockRequestItemIds: lineIds,
    source: "transfers.createTransfer",
    actorUserId: data.createdByUserId ?? null,
  });

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      status: "DRAFT",
      createdByUserId: data.createdByUserId || null,
      items: {
        create: data.items.map((item) => ({
          variantId: item.variantId,
          lotId: item.lotId ?? null,
          stockRequestItemId: item.stockRequestItemId != null ? item.stockRequestItemId : null,
          quantitySent: item.quantity,
          quantityReceived: 0,
          quantityDamaged: 0,
          quantityExpired: 0,
        })),
      },
    },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
            },
          },
          lot: {
            select: {
              id: true,
              lotCode: true,
              expDate: true,
            },
          },
        },
      },
    },
  });

  return transfer;
}

/**
 * @deprecated Use sendDispatch from dispatches.service instead.
 * Send transfer (TRANSFER_OUT ledger entries, status IN_TRANSIT)
 */
async function sendTransfer(transferId: number, createdByUserId?: number) {
  console.warn("[DEPRECATED] sendTransfer called. Use StockDispatch flow instead. Transfer ID:", transferId);

  const transferPreview = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    include: { items: true },
  });

  if (!transferPreview) {
    throw new Error("Transfer not found");
  }

  if (transferPreview.status !== "DRAFT") {
    throw new Error(`Transfer is already ${transferPreview.status}`);
  }

  const lineIds = transferPreview.items
    .map((i) => i.stockRequestItemId)
    .filter((x): x is number => x != null && x > 0);
  await assertLegacyStockTransferAllowedForDraftPayload({
    stockRequestId: transferPreview.stockRequestId ?? null,
    stockRequestItemIds: lineIds,
    source: "transfers.sendTransfer",
    actorUserId: createdByUserId ?? null,
  });

  return await prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { items: true },
    });

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    if (transfer.status !== "DRAFT") {
      throw new Error(`Transfer is already ${transfer.status}`);
    }

    const ledgerIds: number[] = [];

    for (const item of transfer.items) {
      if (!item.lotId) {
        const aggregate = await tx.stockBalance.findUnique({
          where: {
            locationId_variantId: {
              locationId: transfer.fromLocationId,
              variantId: item.variantId,
            },
          },
        });
        const available = aggregate?.onHandQty ?? 0;
        if (available < item.quantitySent) {
          throw new Error(
            `Insufficient aggregate stock for variant ${item.variantId}. Available: ${available}, Required: ${item.quantitySent}`
          );
        }
        const ledger = await ledgerService.recordLedgerEntryInTx(tx, {
          locationId: transfer.fromLocationId,
          variantId: item.variantId,
          lotId: null,
          type: "TRANSFER_OUT",
          quantityDelta: -item.quantitySent,
          refType: "TRANSFER",
          refId: transferId.toString(),
          createdByUserId: createdByUserId ?? undefined,
        });
        ledgerIds.push(ledger.id);
        continue;
      }

      const lot = await tx.stockLot.findUnique({
        where: { id: item.lotId },
        select: { expDate: true, lotCode: true, variantId: true },
      });
      if (!lot || lot.variantId !== item.variantId) {
        throw new Error(`Invalid lotId ${item.lotId} or variant mismatch`);
      }
      if (lot.expDate && new Date() >= lot.expDate) {
        const err = new Error(`Lot ${lot.lotCode} has expired`);
        (err as any).code = "LOT_EXPIRED";
        throw err;
      }
      const lotBalance = await tx.stockLotBalance.findUnique({
        where: {
          locationId_lotId: {
            locationId: transfer.fromLocationId,
            lotId: item.lotId,
          },
        },
      });
      const available = lotBalance?.onHandQty ?? 0;
      if (available < item.quantitySent) {
        throw new Error(
          `Insufficient lot stock for lot ${lot.lotCode}. Available: ${available}, Required: ${item.quantitySent}`
        );
      }

      const ledger = await ledgerService.recordLedgerEntryInTx(tx, {
        locationId: transfer.fromLocationId,
        variantId: item.variantId,
        lotId: item.lotId,
        type: "TRANSFER_OUT",
        quantityDelta: -item.quantitySent,
        refType: "TRANSFER",
        refId: transferId.toString(),
        createdByUserId: createdByUserId ?? undefined,
      });

      ledgerIds.push(ledger.id);
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: "IN_TRANSIT",
        sentAt: new Date(),
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
              },
            },
            lot: {
              select: {
                id: true,
                lotCode: true,
                expDate: true,
              },
            },
          },
        },
      },
    });

    return { transfer: updated, ledgerIds };
  });
}

/**
 * @deprecated Use receiveDispatch from dispatches.service with controlled receive session.
 * Receive transfer (TRANSFER_IN ledger entries).
 * On mismatch: create StockDiscrepancy, set status DISPUTED.
 * Accepts SENT or IN_TRANSIT for backward compatibility.
 */
async function receiveTransfer(
  transferId: number,
  data: {
    items: Array<{
      /** When set, receive line maps 1:1 to this transfer row (multi-line same variant / partial waves). */
      transferItemId?: number;
      variantId: number;
      quantityReceived: number;
      quantityDamaged?: number;
      quantityExpired?: number;
      lotId?: number;
    }>;
    notes?: string;
    evidenceMediaIds?: number[];
    createdByUserId?: number;
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { items: true },
    });

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    if (transfer.stockRequestId) {
      const n = await tx.stockDispatch.count({
        where: { stockRequestId: transfer.stockRequestId },
      });
      if (n > 0) {
        throw new Error(
          "This stock request is fulfilled via StockDispatch (enterprise). Receive goods using the dispatch receive session, not StockTransfer receive."
        );
      }
    }

    const allowedStatuses = ["SENT", "IN_TRANSIT"];
    if (!allowedStatuses.includes(transfer.status)) {
      throw new Error(`Transfer must be SENT or IN_TRANSIT to receive. Current: ${transfer.status}`);
    }

    // If items empty, treat as full receive (backward compat with UI that sends items: [])
    const receiveItems =
      data.items.length > 0
        ? data.items
        : transfer.items.map((i) => ({
            transferItemId: i.id,
            variantId: i.variantId,
            quantityReceived: i.quantitySent,
            quantityDamaged: 0,
            quantityExpired: 0,
            lotId: i.lotId ?? undefined,
          }));

    const usedTransferItemIds = new Set<number>();

    function resolveTransferItem(receiveItem: (typeof receiveItems)[0]) {
      if (receiveItem.transferItemId != null) {
        const tid = Number(receiveItem.transferItemId);
        const ti = transfer.items.find((i) => i.id === tid);
        if (!ti) {
          throw new Error(`transferItemId ${tid} does not belong to this transfer`);
        }
        if (usedTransferItemIds.has(ti.id)) {
          throw new Error(`Duplicate receive line for transferItemId ${tid}`);
        }
        if (ti.variantId !== receiveItem.variantId) {
          throw new Error(`variantId does not match transfer item ${tid}`);
        }
        usedTransferItemIds.add(ti.id);
        return ti;
      }

      const lotIdRecv = receiveItem.lotId ?? undefined;
      const candidates = transfer.items
        .filter((i) => {
          if (usedTransferItemIds.has(i.id)) return false;
          if (i.variantId !== receiveItem.variantId) return false;
          if (lotIdRecv != null) {
            return i.lotId === lotIdRecv;
          }
          // No lot on receive line: only match aggregate (non-lot) transfer rows; lot-backed lines need transferItemId or explicit lotId
          return i.lotId == null;
        })
        .sort((a, b) => a.id - b.id);

      const ti = candidates[0];
      if (!ti) {
        throw new Error(
          `No unmatched transfer line for variantId ${receiveItem.variantId}` +
            (lotIdRecv != null ? ` lotId ${lotIdRecv}` : "")
        );
      }
      usedTransferItemIds.add(ti.id);
      return ti;
    }

    const ledgerIds: number[] = [];
    let hasMismatch = false;
    const discrepancies: Array<{
      transferItemId: number;
      variantId: number;
      lotId: number | null;
      expectedQty: number;
      receivedQty: number;
      damagedQty: number;
      expiredQty: number;
      missingQty: number;
    }> = [];

    const receivedQtyByTransferItemId = new Map<number, number>();

    for (const receiveItem of receiveItems) {
      const transferItem = resolveTransferItem(receiveItem);

      const qtyReceived = receiveItem.quantityReceived ?? 0;
      const qtyDamaged = receiveItem.quantityDamaged ?? 0;
      const qtyExpired = receiveItem.quantityExpired ?? 0;
      const total = qtyReceived + qtyDamaged + qtyExpired;
      const expected = transferItem.quantitySent;
      const missingQty = Math.max(0, expected - total);

      if (total !== expected) {
        hasMismatch = true;
        discrepancies.push({
          transferItemId: transferItem.id,
          variantId: receiveItem.variantId,
          lotId: transferItem.lotId,
          expectedQty: expected,
          receivedQty: qtyReceived,
          damagedQty: qtyDamaged,
          expiredQty: qtyExpired,
          missingQty,
        });
      }

      await tx.stockTransferItem.update({
        where: { id: transferItem.id },
        data: {
          quantityReceived: qtyReceived,
          quantityDamaged: qtyDamaged,
          quantityExpired: qtyExpired,
        },
      });
      receivedQtyByTransferItemId.set(transferItem.id, qtyReceived);

      const lotId = receiveItem.lotId ?? transferItem.lotId ?? undefined;

      if (qtyReceived > 0) {
        const ledger = await ledgerService.recordLedgerEntryInTx(tx, {
          locationId: transfer.toLocationId,
          variantId: receiveItem.variantId,
          lotId,
          type: "TRANSFER_IN",
          quantityDelta: qtyReceived,
          refType: "TRANSFER",
          refId: transferId.toString(),
          createdByUserId: data.createdByUserId,
        });
        ledgerIds.push(ledger.id);
      }

      if (qtyDamaged > 0) {
        const ledger = await ledgerService.recordLedgerEntryInTx(tx, {
          locationId: transfer.toLocationId,
          variantId: receiveItem.variantId,
          lotId,
          type: "DAMAGE",
          quantityDelta: -qtyDamaged,
          refType: "TRANSFER",
          refId: transferId.toString(),
          createdByUserId: data.createdByUserId,
        });
        ledgerIds.push(ledger.id);
      }

      if (qtyExpired > 0) {
        const ledger = await ledgerService.recordLedgerEntryInTx(tx, {
          locationId: transfer.toLocationId,
          variantId: receiveItem.variantId,
          lotId,
          type: "EXPIRED",
          quantityDelta: -qtyExpired,
          refType: "TRANSFER",
          refId: transferId.toString(),
          createdByUserId: data.createdByUserId,
        });
        ledgerIds.push(ledger.id);
      }
    }

    const totalReceived = transfer.items.reduce(
      (sum, ti) => sum + (receivedQtyByTransferItemId.get(ti.id) ?? 0),
      0
    );
    const totalSent = transfer.items.reduce((sum, i) => sum + i.quantitySent, 0);
    let newStatus: "PARTIAL_RECEIVED" | "COMPLETED" | "DISPUTED" =
      hasMismatch ? "DISPUTED" : totalReceived < totalSent ? "PARTIAL_RECEIVED" : "COMPLETED";

    if (hasMismatch) {
      for (const d of discrepancies) {
        await tx.stockDiscrepancy.create({
          data: {
            transferId,
            transferItemId: d.transferItemId,
            variantId: d.variantId,
            lotId: d.lotId,
            expectedQty: d.expectedQty,
            receivedQty: d.receivedQty,
            damagedQty: d.damagedQty,
            missingQty: d.missingQty,
            notes: data.notes ?? null,
            evidenceMediaIds: data.evidenceMediaIds ? (data.evidenceMediaIds as any) : null,
            status: "PENDING",
          },
        });
      }
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: newStatus,
        receivedAt: new Date(),
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
              },
            },
            lot: {
              select: {
                id: true,
                lotCode: true,
                expDate: true,
              },
            },
          },
        },
        discrepancies: true,
      },
    });

    const fullReceived = newStatus === "COMPLETED";
    return { transfer: updated, ledgerIds, hasMismatch, fullReceived };
  });

  const stockRequestService = require("../stock_requests/stock_requests.service");
  await stockRequestService.markRequestReceivedIfLinked(transferId, result.fullReceived);

  const { logWarehouseAudit } = require("../warehouse/warehouseAudit.service");
  const { resolveOrgIdForLocation } = require("../inventory/stockAvailability.service");
  const toLoc = result.transfer.toLocationId;
  const recvOrgId = await resolveOrgIdForLocation(toLoc);
  if (recvOrgId != null) {
    const whId = (result.transfer as { toLocation?: { warehouseId: number | null } }).toLocation?.warehouseId ?? null;
    void logWarehouseAudit({
      orgId: recvOrgId,
      warehouseId: whId,
      category: "OPERATIONS",
      action: "TRANSFER_RECEIVE",
      entityType: "StockTransfer",
      entityId: String(transferId),
      metadata: {
        hasMismatch: result.hasMismatch,
        ledgerEntryCount: result.ledgerIds.length,
        status: result.transfer.status,
        stockRequestId: (result.transfer as { stockRequestId?: number | null }).stockRequestId ?? null,
      },
      actorUserId: data.createdByUserId ?? null,
    }).catch(() => {});
  }

  return { transfer: result.transfer, ledgerIds: result.ledgerIds, hasMismatch: result.hasMismatch };
}

/**
 * Owner: Resolve a disputed transfer.
 * resolutionType: ACCEPT_LOSS | RESEND | DAMAGE_WRITEOFF
 */
async function resolveDispute(
  transferId: number,
  data: {
    resolutionType: "ACCEPT_LOSS" | "RESEND" | "DAMAGE_WRITEOFF";
    note?: string;
    resolvedByUserId?: number;
  }
) {
  return await prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { items: true, discrepancies: true },
    });

    if (!transfer) {
      throw new Error("Transfer not found");
    }

    if (transfer.status !== "DISPUTED") {
      throw new Error(`Transfer is not DISPUTED. Current: ${transfer.status}`);
    }

    const ledgerIds: number[] = [];

    for (const d of transfer.discrepancies) {
      if (d.status !== "PENDING") continue;

      if (data.resolutionType === "ACCEPT_LOSS" && d.missingQty > 0) {
        await ledgerService.recordLedgerEntryInTx(tx, {
          locationId: transfer.toLocationId,
          variantId: d.variantId,
          lotId: d.lotId ?? undefined,
          type: "LOSS",
          quantityDelta: -d.missingQty,
          refType: "TRANSFER_DISCREPANCY",
          refId: `${transferId}:${d.id}`,
          createdByUserId: data.resolvedByUserId,
        });
      }

      await tx.stockDiscrepancy.update({
        where: { id: d.id },
        data: {
          status: "RESOLVED",
          resolvedByUserId: data.resolvedByUserId ?? null,
          resolvedAt: new Date(),
          resolutionNote: data.note ?? null,
        },
      });
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: "COMPLETED",
      },
      include: {
        fromLocation: true,
        toLocation: true,
        items: true,
        discrepancies: true,
      },
    });

    return { transfer: updated, ledgerIds };
  });
}

/**
 * Get transfers with filters
 */
async function getTransfers(options: {
  fromLocationId?: number;
  toLocationId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.fromLocationId) where.fromLocationId = options.fromLocationId;
  if (options.toLocationId) where.toLocationId = options.toLocationId;
  if (options.status) where.status = options.status;

  const [transfers, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        fromLocation: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        toLocation: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
              },
            },
            lot: {
              select: {
                id: true,
                lotCode: true,
                expDate: true,
              },
            },
          },
        },
        discrepancies: true,
        createdBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    }),
    prisma.stockTransfer.count({ where }),
  ]);

  return {
    items: transfers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single transfer
 */
async function getTransferById(transferId: number) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromLocation: true,
      toLocation: true,
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
            },
          },
          lot: {
            select: {
              id: true,
              lotCode: true,
              expDate: true,
            },
          },
        },
      },
      discrepancies: true,
      createdBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  return transfer;
}

module.exports = {
  createTransfer,
  sendTransfer,
  receiveTransfer,
  resolveDispute,
  getTransfers,
  getTransferById,
};
