import prisma from "../../../../infrastructure/db/prismaClient";
import { INVENTORY_ERROR_CODES } from "../../constants/inventoryErrors";
import {
  getFrozenRecallLotIds,
  getFrozenRecallLotIdsWithTx,
  getPendingQcHoldByLot,
  getPendingQcHoldByLotWithTx,
  resolveOrgIdForLocation,
  resolveOrgIdForLocationWithTx,
} from "./stockAvailability.service";

function isInboundBalanceCreateType(type: string): boolean {
  return type === "OPENING" || type === "TRANSFER_IN" || type === "QUARANTINE_IN";
}

/**
 * Ledger Service - Handles immutable StockLedger writes and StockBalance/StockLotBalance updates
 * All stock changes must go through this service to maintain auditability
 * Batch-wise: lotId is required for new stock-changing operations
 */

/**
 * Assert lot is not expired. Throws with code LOT_EXPIRED if expired.
 */
export async function assertLotNotExpired(lotId: number): Promise<void> {
  const lot = await prisma.stockLot.findUnique({
    where: { id: lotId },
    select: { expDate: true, lotCode: true },
  });
  if (!lot) throw new Error("Lot not found");
  if (lot.expDate && new Date() >= lot.expDate) {
    const err = new Error(`Lot ${lot.lotCode} has expired`);
    (err as any).code = INVENTORY_ERROR_CODES.LOT_EXPIRED;
    throw err;
  }
}

type LedgerEntryInput = {
  orgId?: number | null;
  locationId: number;
  variantId: number;
  lotId?: number | null;
  type: string;
  quantityDelta: number;
  unitCost?: number | null;
  refType?: string;
  refId?: string;
  createdByUserId?: number;
};

function isReserveOnlineLike(type: string): boolean {
  return type === "RESERVE_ONLINE" || type === "RESERVE_FULFILLMENT";
}

function isReleaseReserveLike(type: string): boolean {
  return type === "RELEASE_RESERVE" || type === "RELEASE_FULFILLMENT_RESERVE";
}

function applyBalanceDelta(
  type: string,
  currentOnHand: number,
  currentReserved: number,
  quantityDelta: number
): { onHand: number; reserved: number } {
  if (isReserveOnlineLike(type)) {
    return {
      onHand: currentOnHand - quantityDelta,
      reserved: currentReserved + quantityDelta,
    };
  }
  if (isReleaseReserveLike(type)) {
    return {
      onHand: currentOnHand - quantityDelta, // quantityDelta is negative
      reserved: currentReserved + quantityDelta,
    };
  }
  return {
    onHand: currentOnHand + quantityDelta,
    reserved: currentReserved,
  };
}

/**
 * Internal: record ledger entry using given transaction client.
 * Rejects expired lots for outbound operations (quantityDelta < 0), except when
 * type is EXPIRED (expiry job writing off expired stock).
 * Also rejects recalled lots for outbound operations (except ADJUSTMENT for quarantine).
 */
async function recordLedgerEntryInTx(tx: any, data: LedgerEntryInput) {
    let resolvedOrgId: number | null | undefined = data.orgId ?? undefined;
    if (resolvedOrgId == null) {
      resolvedOrgId = await resolveOrgIdForLocationWithTx(tx, data.locationId);
    }

    // Safety check 1: Reject expired lots for outbound
    if (data.lotId && data.quantityDelta < 0 && data.type !== "EXPIRED") {
      const lot = await tx.stockLot.findUnique({
        where: { id: data.lotId },
        select: { expDate: true, lotCode: true },
      });
      if (lot && lot.expDate && new Date() >= lot.expDate) {
        const err = new Error(`Lot ${lot.lotCode} has expired`);
        (err as any).code = INVENTORY_ERROR_CODES.LOT_EXPIRED;
        throw err;
      }
    }

    // Safety check 2: Reject recalled lots for outbound (except quarantine transfers), unless allocation explicitly released
    const recallOutboundBypass =
      data.refType === "RECALL_QUARANTINE" ||
      data.refType === "QC_QUARANTINE_RELEASE" ||
      data.refType === "QC_QUARANTINE_DISPOSE";
    if (data.lotId && data.quantityDelta < 0 && data.type !== "EXPIRED" && !recallOutboundBypass) {
      const recallWhere: Record<string, unknown> = {
        lotId: data.lotId,
        status: "ACTIVE",
        allocationReleasedAt: null,
      };
      if (resolvedOrgId != null) {
        recallWhere.orgId = resolvedOrgId;
      }
      const recallRows = await tx.batchRecall.findMany({
        where: recallWhere as any,
        take: 1,
        select: { id: true, severity: true },
      });
      const activeRecall = recallRows[0];

      if (activeRecall) {
        const err = new Error(
          `Lot is under active ${activeRecall.severity} recall (Recall ID: ${activeRecall.id}). Cannot process outbound movement.`
        );
        (err as any).code = INVENTORY_ERROR_CODES.LOT_RECALLED;
        throw err;
      }
    }

    // 1. Create ledger entry (immutable)
    const ledger = await tx.stockLedger.create({
      data: {
        orgId: resolvedOrgId ?? null,
        locationId: data.locationId,
        variantId: data.variantId,
        lotId: data.lotId ?? null,
        type: data.type as any,
        quantityDelta: data.quantityDelta,
        unitCost: data.unitCost != null ? data.unitCost : undefined,
        refType: data.refType || null,
        refId: data.refId || null,
        createdByUserId: data.createdByUserId || null,
      },
    });

    // 2. Update or create StockLotBalance when lotId is provided
    if (data.lotId) {
      const existingLotBalance = await tx.stockLotBalance.findUnique({
        where: {
          locationId_lotId: {
            locationId: data.locationId,
            lotId: data.lotId,
          },
        },
      });

      const { onHand: newOnHand, reserved: newReserved } = applyBalanceDelta(
        data.type,
        existingLotBalance?.onHandQty ?? 0,
        existingLotBalance?.reservedQty ?? 0,
        data.quantityDelta
      );

      if (newOnHand < 0 || newReserved < 0) {
        throw new Error(
          `Insufficient lot stock. type=${data.type}, delta=${data.quantityDelta}, lotId=${data.lotId}`
        );
      }

      if (existingLotBalance) {
        await tx.stockLotBalance.update({
          where: {
            locationId_lotId: {
              locationId: data.locationId,
              lotId: data.lotId,
            },
          },
          data: { onHandQty: newOnHand, reservedQty: newReserved },
        });
      } else {
        if (!isInboundBalanceCreateType(data.type) && data.quantityDelta < 0) {
          throw new Error("Cannot create negative lot balance for non-inbound entry");
        }
        await tx.stockLotBalance.create({
          data: {
            locationId: data.locationId,
            lotId: data.lotId,
            onHandQty: isReserveOnlineLike(data.type) ? -data.quantityDelta : newOnHand,
            reservedQty: isReserveOnlineLike(data.type) ? data.quantityDelta : newReserved,
          },
        });
      }
    }

    // 3. Update or create StockBalance (aggregated per location+variant)
    const existingBalance = await tx.stockBalance.findUnique({
      where: {
        locationId_variantId: {
          locationId: data.locationId,
          variantId: data.variantId,
        },
      },
    });

    const { onHand: newOnHand, reserved: newReserved } = applyBalanceDelta(
      data.type,
      existingBalance?.onHandQty ?? 0,
      existingBalance?.reservedQty ?? 0,
      data.quantityDelta
    );

    if (newOnHand < 0) {
      throw new Error(
        `Insufficient stock. Available: ${existingBalance?.onHandQty ?? 0}, Requested: ${Math.abs(data.quantityDelta)}`
      );
    }
    if (newReserved < 0) {
      throw new Error(`Invalid reserved quantity. Delta: ${data.quantityDelta}`);
    }

    if (existingBalance) {
      await tx.stockBalance.update({
        where: {
          locationId_variantId: {
            locationId: data.locationId,
            variantId: data.variantId,
          },
        },
        data: { onHandQty: newOnHand, reservedQty: newReserved },
      });
    } else {
      if (!isInboundBalanceCreateType(data.type) && data.quantityDelta < 0) {
        throw new Error("Cannot create negative balance for non-inbound entry");
      }
      await tx.stockBalance.create({
        data: {
          locationId: data.locationId,
          variantId: data.variantId,
          onHandQty: isReserveOnlineLike(data.type) ? -data.quantityDelta : data.quantityDelta,
          reservedQty: isReserveOnlineLike(data.type) ? data.quantityDelta : 0,
        },
      });
    }

    return ledger;
}

/**
 * Record a stock ledger entry and update balance atomically.
 * When lotId is provided, also updates StockLotBalance.
 */
async function recordLedgerEntry(data: LedgerEntryInput) {
  return await prisma.$transaction((tx) => recordLedgerEntryInTx(tx, data));
}

/**
 * Record multiple ledger entries in a single transaction
 */
async function recordMultipleLedgerEntries(
  entries: Array<LedgerEntryInput>
) {
  return await prisma.$transaction(async (tx) => {
    const ledgerIds: number[] = [];
    for (const entry of entries) {
      const ledger = await tx.stockLedger.create({
        data: {
          locationId: entry.locationId,
          variantId: entry.variantId,
          lotId: entry.lotId ?? null,
          type: entry.type as any,
          quantityDelta: entry.quantityDelta,
          refType: entry.refType || null,
          refId: entry.refId || null,
          createdByUserId: entry.createdByUserId || null,
        },
      });
      ledgerIds.push(ledger.id);

      // Update lot balance when lotId provided
      if (entry.lotId) {
        const existingLotBalance = await tx.stockLotBalance.findUnique({
          where: {
            locationId_lotId: {
              locationId: entry.locationId,
              lotId: entry.lotId,
            },
          },
        });

        const { onHand: newOnHand, reserved: newReserved } = applyBalanceDelta(
          entry.type,
          existingLotBalance?.onHandQty ?? 0,
          existingLotBalance?.reservedQty ?? 0,
          entry.quantityDelta
        );

        if (newOnHand < 0 || newReserved < 0) {
          throw new Error(`Insufficient lot stock for entry type ${entry.type}`);
        }

        if (existingLotBalance) {
          await tx.stockLotBalance.update({
            where: {
              locationId_lotId: {
                locationId: entry.locationId,
                lotId: entry.lotId,
              },
            },
            data: { onHandQty: newOnHand, reservedQty: newReserved },
          });
        } else {
          if (!isInboundBalanceCreateType(entry.type) && entry.quantityDelta < 0) {
            throw new Error("Cannot create negative lot balance");
          }
          await tx.stockLotBalance.create({
            data: {
              locationId: entry.locationId,
              lotId: entry.lotId,
              onHandQty: isReserveOnlineLike(entry.type) ? -entry.quantityDelta : newOnHand,
              reservedQty: isReserveOnlineLike(entry.type) ? entry.quantityDelta : newReserved,
            },
          });
        }
      }

      // Update aggregated balance
      const existingBalance = await tx.stockBalance.findUnique({
        where: {
          locationId_variantId: {
            locationId: entry.locationId,
            variantId: entry.variantId,
          },
        },
      });

      const { onHand: newOnHand, reserved: newReserved } = applyBalanceDelta(
        entry.type,
        existingBalance?.onHandQty ?? 0,
        existingBalance?.reservedQty ?? 0,
        entry.quantityDelta
      );

      if (newOnHand < 0 || newReserved < 0) {
        throw new Error(`Insufficient stock for entry type ${entry.type}`);
      }

      if (existingBalance) {
        await tx.stockBalance.update({
          where: {
            locationId_variantId: {
              locationId: entry.locationId,
              variantId: entry.variantId,
            },
          },
          data: { onHandQty: newOnHand, reservedQty: newReserved },
        });
      } else {
        if (!isInboundBalanceCreateType(entry.type) && entry.quantityDelta < 0) {
          throw new Error("Cannot create negative balance");
        }
        await tx.stockBalance.create({
          data: {
            locationId: entry.locationId,
            variantId: entry.variantId,
            onHandQty: isReserveOnlineLike(entry.type) ? -entry.quantityDelta : entry.quantityDelta,
            reservedQty: isReserveOnlineLike(entry.type) ? entry.quantityDelta : 0,
          },
        });
      }
    }
    return ledgerIds;
  });
}

/**
 * Get available lots FEFO using transaction client (for use inside $transaction).
 */
async function getAvailableLotsFEFOWithTx(tx: any, locationId: number, variantId: number) {
  const now = new Date();
  const lotBalances = await tx.stockLotBalance.findMany({
    where: {
      locationId,
      lot: {
        variantId,
        expDate: { gt: now },
      },
      onHandQty: { gt: 0 },
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          mfgDate: true,
          expDate: true,
          variantId: true,
          orgId: true,
        },
      },
    },
    orderBy: {
      lot: { expDate: "asc" },
    },
  });
  const orgId = await resolveOrgIdForLocationWithTx(tx, locationId);
  let recallFrozen = new Set<number>();
  let qcPending = new Map<number, number>();
  if (orgId != null && lotBalances.length) {
    const lotIds = lotBalances.map((lb: any) => lb.lotId);
    [recallFrozen, qcPending] = await Promise.all([
      getFrozenRecallLotIdsWithTx(tx, orgId, lotIds),
      getPendingQcHoldByLotWithTx(tx, orgId, locationId),
    ]);
  }
  return lotBalances
    .filter((lb: any) => !recallFrozen.has(lb.lotId))
    .map((lb: any) => {
      const qcBlock = orgId != null ? qcPending.get(lb.lotId) ?? 0 : 0;
      const effOnHand = Math.max(0, lb.onHandQty - qcBlock);
      const availableQty = Math.max(0, effOnHand - lb.reservedQty);
      return {
        lotId: lb.lotId,
        lot: lb.lot,
        onHandQty: effOnHand,
        reservedQty: lb.reservedQty,
        availableQty,
      };
    })
    .filter((row: any) => row.onHandQty > 0);
}

/**
 * Commit sale using FEFO inside an existing transaction (for POS atomicity).
 * Captures COGS (unitCost) for each lot at sale time.
 */
async function saleFEFOInTx(
  tx: any,
  params: {
    locationId: number;
    variantId: number;
    quantity: number;
    saleType: "SALE_POS" | "SALE_ONLINE" | "SALE_CLINIC";
    refType?: string;
    refId?: string;
    createdByUserId?: number;
  }
) {
  const lots = await getAvailableLotsFEFOWithTx(tx, params.locationId, params.variantId);
  let remaining = params.quantity;
  const entries: LedgerEntryInput[] = [];

  for (const item of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, item.onHandQty);
    if (take <= 0) continue;

    // Get unit cost for COGS tracking (using global prisma for read-only lookup)
    const unitCost = await getLotUnitCost(item.lotId);

    entries.push({
      locationId: params.locationId,
      variantId: params.variantId,
      lotId: item.lotId,
      type: params.saleType,
      quantityDelta: -take,
      unitCost,
      refType: params.refType || "ORDER",
      refId: params.refId || null,
      createdByUserId: params.createdByUserId,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(
      `Insufficient stock for sale. Requested: ${params.quantity}, Available: ${params.quantity - remaining}`
    );
  }

  for (const entry of entries) {
    await recordLedgerEntryInTx(tx, entry);
  }
}

/**
 * Record multiple ledger entries using existing transaction client.
 */
async function recordMultipleLedgerEntriesInTx(tx: any, entries: Array<LedgerEntryInput>) {
  const ledgerIds: number[] = [];
  for (const entry of entries) {
    const ledger = await recordLedgerEntryInTx(tx, entry);
    ledgerIds.push(ledger.id);
  }
  return ledgerIds;
}

/**
 * Get stock balance for a location + variant (aggregated)
 */
async function getStockBalance(locationId: number, variantId: number) {
  const balance = await prisma.stockBalance.findUnique({
    where: {
      locationId_variantId: {
        locationId,
        variantId,
      },
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
    },
  });

  return (
    balance || {
      locationId,
      variantId,
      onHandQty: 0,
      reservedQty: 0,
      location: null,
      variant: null,
    }
  );
}

/**
 * Get available lots for a location + variant, ordered by expiry (FEFO).
 * Excludes expired lots.
 */
async function getAvailableLotsFEFO(locationId: number, variantId: number) {
  const now = new Date();
  const lotBalances = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      lot: {
        variantId,
        expDate: { gt: now },
      },
      onHandQty: { gt: 0 },
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          mfgDate: true,
          expDate: true,
          variantId: true,
          orgId: true,
        },
      },
    },
    orderBy: {
      lot: { expDate: "asc" },
    },
  });

  const orgId = await resolveOrgIdForLocation(locationId);
  let recallFrozen = new Set<number>();
  let qcPending = new Map<number, number>();
  if (orgId != null && lotBalances.length) {
    const lotIds = lotBalances.map((lb) => lb.lotId);
    [recallFrozen, qcPending] = await Promise.all([
      getFrozenRecallLotIds(orgId, lotIds),
      getPendingQcHoldByLot(orgId, locationId),
    ]);
  }

  return lotBalances
    .filter((lb) => !recallFrozen.has(lb.lotId))
    .map((lb) => {
      const qcBlock = orgId != null ? qcPending.get(lb.lotId) ?? 0 : 0;
      const effOnHand = Math.max(0, lb.onHandQty - qcBlock);
      const availableQty = Math.max(0, effOnHand - lb.reservedQty);
      return {
        lotId: lb.lotId,
        lot: lb.lot,
        onHandQty: effOnHand,
        reservedQty: lb.reservedQty,
        availableQty,
      };
    })
    .filter((row) => row.onHandQty > 0);
}

/**
 * Reserve stock using FEFO (First Expire First Out).
 * Creates RESERVE_ONLINE ledger entries across lots.
 */
async function reserveFEFO(params: {
  locationId: number;
  variantId: number;
  quantity: number;
  refType?: string;
  refId?: string;
  createdByUserId?: number;
}) {
  const lots = await getAvailableLotsFEFO(params.locationId, params.variantId);
  let remaining = params.quantity;
  const entries: LedgerEntryInput[] = [];

  for (const item of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, item.availableQty);
    if (take <= 0) continue;

    entries.push({
      locationId: params.locationId,
      variantId: params.variantId,
      lotId: item.lotId,
      type: "RESERVE_ONLINE",
      quantityDelta: take,
      refType: params.refType || "CART",
      refId: params.refId || null,
      createdByUserId: params.createdByUserId,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(
      `Insufficient available stock for FEFO reserve. Requested: ${params.quantity}, Available: ${params.quantity - remaining}`
    );
  }

  return recordMultipleLedgerEntries(entries);
}

/**
 * Get weighted average cost for a lot based on ledger history.
 * Used for COGS calculation at sale time.
 */
async function getLotUnitCost(lotId: number): Promise<number | null> {
  const inboundEntries = await prisma.stockLedger.findMany({
    where: {
      lotId,
      type: { in: ["GRN_IN", "PURCHASE_IN", "TRANSFER_IN", "OPENING", "RETURN_IN"] },
      quantityDelta: { gt: 0 },
      unitCost: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      quantityDelta: true,
      unitCost: true,
    },
  });

  if (inboundEntries.length === 0) return null;

  let totalQty = 0;
  let totalCost = 0;
  for (const entry of inboundEntries) {
    const qty = entry.quantityDelta;
    const cost = Number(entry.unitCost);
    totalQty += qty;
    totalCost += qty * cost;
  }

  if (totalQty === 0) return null;
  return totalCost / totalQty;
}

/**
 * Commit sale using FEFO (deduct from earliest expiring lots).
 * Creates SALE_POS, SALE_ONLINE, or SALE_CLINIC + optional RELEASE_RESERVE entries.
 * Captures COGS (unitCost) for each lot at sale time.
 */
async function saleFEFO(params: {
  locationId: number;
  variantId: number;
  quantity: number;
  saleType: "SALE_POS" | "SALE_ONLINE" | "SALE_CLINIC";
  refType?: string;
  refId?: string;
  createdByUserId?: number;
  releaseReserve?: boolean;
}) {
  const lots = await getAvailableLotsFEFO(params.locationId, params.variantId);
  let remaining = params.quantity;
  const entries: LedgerEntryInput[] = [];

  for (const item of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, item.onHandQty);
    if (take <= 0) continue;

    // Get unit cost for COGS tracking
    const unitCost = await getLotUnitCost(item.lotId);

    entries.push({
      locationId: params.locationId,
      variantId: params.variantId,
      lotId: item.lotId,
      type: params.saleType,
      quantityDelta: -take,
      unitCost,
      refType: params.refType || "ORDER",
      refId: params.refId || null,
      createdByUserId: params.createdByUserId,
    });

    if (params.releaseReserve) {
      const releaseQty = Math.min(take, item.reservedQty);
      if (releaseQty > 0) {
        entries.push({
          locationId: params.locationId,
          variantId: params.variantId,
          lotId: item.lotId,
          type: "RELEASE_RESERVE",
          quantityDelta: -releaseQty,
          refType: params.refType || "ORDER",
          refId: params.refId || null,
          createdByUserId: params.createdByUserId,
        });
      }
    }
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(
      `Insufficient stock for sale. Requested: ${params.quantity}, Available: ${params.quantity - remaining}`
    );
  }

  return recordMultipleLedgerEntries(entries);
}

/**
 * Restore stock for a cancelled order: same locationId, RETURN_IN ledger entries, refType ORDER_CANCEL.
 */
async function restoreStockForOrderCancel(params: {
  locationId: number;
  items: Array<{ variantId: number; quantity: number }>;
  refId: string;
  createdByUserId?: number;
}) {
  const entries: LedgerEntryInput[] = [];
  for (const item of params.items) {
    if (item.quantity <= 0) continue;
    entries.push({
      locationId: params.locationId,
      variantId: item.variantId,
      quantityDelta: item.quantity,
      type: "RETURN_IN",
      refType: "ORDER_CANCEL",
      refId: params.refId,
      createdByUserId: params.createdByUserId,
    });
  }
  return recordMultipleLedgerEntries(entries);
}

/**
 * Get ledger history for a location + variant
 */
async function getLedgerHistory(options: {
  locationId?: number;
  variantId?: number;
  lotId?: number;
  type?: string;
  refType?: string;
  refId?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.locationId) where.locationId = options.locationId;
  if (options.variantId) where.variantId = options.variantId;
  if (options.lotId != null) where.lotId = options.lotId;
  if (options.type) where.type = options.type;
  if (options.refType) where.refType = options.refType;
  if (options.refId) where.refId = options.refId;

  const [ledgers, total] = await Promise.all([
    prisma.stockLedger.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
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
    prisma.stockLedger.count({ where }),
  ]);

  return {
    items: ledgers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  recordLedgerEntry,
  recordLedgerEntryInTx,
  recordMultipleLedgerEntries,
  recordMultipleLedgerEntriesInTx,
  getStockBalance,
  getLedgerHistory,
  getAvailableLotsFEFO,
  getAvailableLotsFEFOWithTx,
  reserveFEFO,
  saleFEFO,
  saleFEFOInTx,
  restoreStockForOrderCancel,
  assertLotNotExpired,
  INVENTORY_ERROR_CODES,
};

/** Named export for TypeScript ESM `import` from pricing modules. */
export { getAvailableLotsFEFO, getAvailableLotsFEFOWithTx };
