/**
 * Enterprise facade over ledger.service — single documented import path for stock movements.
 */
import prisma from "../../../../../infrastructure/db/prismaClient";

const ledgerService = require("../ledger.service");

export const recordLedgerEntry = ledgerService.recordLedgerEntry;
export const recordLedgerEntryInTx = ledgerService.recordLedgerEntryInTx;
export const recordMultipleLedgerEntries = ledgerService.recordMultipleLedgerEntries;
export const getStockBalance = ledgerService.getStockBalance;
export const getLedgerHistory = ledgerService.getLedgerHistory;
export const getAvailableLotsFEFO = ledgerService.getAvailableLotsFEFO;
/** Alias for Phase-2 fulfillment / picking — FEFO-ordered lot slices at a location. */
export const getFefoPickCandidates = ledgerService.getAvailableLotsFEFO;
export const assertLotNotExpired = ledgerService.assertLotNotExpired;

/**
 * Available on-hand (aggregate) for a variant across all active locations in a warehouse, tenant-scoped.
 * Uses StockBalance.onHandQty − reservedQty semantics aligned with other inventory reads.
 */
export async function getAvailableStock(
  orgId: number,
  warehouseId: number,
  variantId: number
): Promise<number> {
  const locations = await prisma.inventoryLocation.findMany({
    where: {
      warehouseId,
      isActive: true,
      branch: { orgId },
    },
    select: { id: true },
  });
  if (!locations.length) return 0;

  const balances = await prisma.stockBalance.findMany({
    where: {
      variantId,
      locationId: { in: locations.map((l) => l.id) },
    },
  });

  let sum = 0;
  for (const b of balances) {
    sum += Math.max(0, b.onHandQty - b.reservedQty);
  }
  return sum;
}
