import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");

/**
 * Create a stock transfer (draft).
 * Lot-backed only: lotId is required for each item.
 */
async function createTransfer(data: {
  fromLocationId: number;
  toLocationId: number;
  items: Array<{ variantId: number; quantity: number; lotId: number }>;
  createdByUserId?: number;
}) {
  const transfer = await prisma.stockTransfer.create({
    data: {
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      status: "DRAFT",
      createdByUserId: data.createdByUserId || null,
      items: {
        create: data.items.map((item) => ({
          variantId: item.variantId,
          lotId: item.lotId,
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
 * Send transfer (TRANSFER_OUT ledger entries, status IN_TRANSIT)
 */
async function sendTransfer(transferId: number, createdByUserId?: number) {
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
        throw new Error(`lotId required for transfer item (variantId ${item.variantId}). Lot-backed transfers only.`);
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
 * Receive transfer (TRANSFER_IN ledger entries).
 * On mismatch: create StockDiscrepancy, set status DISPUTED.
 * Accepts SENT or IN_TRANSIT for backward compatibility.
 */
async function receiveTransfer(
  transferId: number,
  data: {
    items: Array<{
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

    const allowedStatuses = ["SENT", "IN_TRANSIT"];
    if (!allowedStatuses.includes(transfer.status)) {
      throw new Error(`Transfer must be SENT or IN_TRANSIT to receive. Current: ${transfer.status}`);
    }

    // If items empty, treat as full receive (backward compat with UI that sends items: [])
    const receiveItems =
      data.items.length > 0
        ? data.items
        : transfer.items.map((i) => ({
            variantId: i.variantId,
            quantityReceived: i.quantitySent,
            quantityDamaged: 0,
            quantityExpired: 0,
            lotId: i.lotId ?? undefined,
          }));

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

    for (const receiveItem of receiveItems) {
      const transferItem = transfer.items.find((i) => i.variantId === receiveItem.variantId);
      if (!transferItem) {
        throw new Error(`Item variantId ${receiveItem.variantId} not found in transfer`);
      }

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
      (sum, i) => sum + (receiveItems.find((r) => r.variantId === i.variantId)?.quantityReceived ?? 0),
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
