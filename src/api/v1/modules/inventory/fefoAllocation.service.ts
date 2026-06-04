/**
 * FEFO (first expiry, first out) lot selection at a location.
 * Read-only against StockLotBalance; does not write ledger.
 * Excludes: pending QC hold qty, active recall lots without allocation release.
 * Wave-3: no allocation from quarantine / damage / returns holding locations (not sellable dispatch faces).
 */
import type { InventoryLocationType } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  getFrozenRecallLotIds,
  getPendingQcHoldByLot,
} from "./stockAvailability.service";
import { fefoLotExpDateEligibleFilter } from "./lotExpiryCalendar";

export type FefoSlice = { lotId: number; locationId: number; quantity: number };

const NON_DISPATCH_LOCATION_TYPES: InventoryLocationType[] = ["QUARANTINE", "DAMAGE_AREA", "RETURN_AREA"];

/** Locations where stock is segregated — never use for normal FEFO dispatch. */
export async function isDispatchSellableLocation(locationId: number): Promise<boolean> {
  const loc = await prisma.inventoryLocation.findUnique({
    where: { id: locationId },
    select: { type: true, isActive: true },
  });
  if (!loc?.isActive) return false;
  return !NON_DISPATCH_LOCATION_TYPES.includes(loc.type);
}

export async function allocateVariantFifo(
  orgId: number,
  locationId: number,
  variantId: number,
  quantityNeeded: number
): Promise<FefoSlice[]> {
  if (quantityNeeded <= 0) return [];
  const sellable = await isDispatchSellableLocation(locationId);
  if (!sellable) return [];

  const rows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: {
        orgId,
        variantId,
        expDate: fefoLotExpDateEligibleFilter(),
      },
    },
    include: { lot: { select: { id: true, expDate: true } } },
    orderBy: { lot: { expDate: "asc" } },
  });

  const lotIds = rows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, locationId),
  ]);

  const out: FefoSlice[] = [];
  let need = quantityNeeded;
  for (const row of rows) {
    if (need <= 0) break;
    if (recallFrozen.has(row.lotId)) continue;
    const qcBlock = qcPending.get(row.lotId) ?? 0;
    // Subtract both reservedQty and QC hold from available
    const effective = row.onHandQty - row.reservedQty - qcBlock;
    if (effective <= 0) continue;
    const take = Math.min(need, effective);
    if (take > 0) {
      out.push({ lotId: row.lotId, locationId, quantity: take });
      need -= take;
    }
  }

  if (need > 0) {
    throw new Error(
      `Insufficient stock for variant ${variantId} at location ${locationId} (FEFO). Short by ${need}.`
    );
  }

  return out;
}

/**
 * FEFO allocation up to quantityNeeded: never throws for shortage; returns unfilled remainder as shortBy.
 * Used by enterprise allocation plans for partial allocation + shortage tracking.
 */
export async function allocateVariantFifoUpTo(
  orgId: number,
  locationId: number,
  variantId: number,
  quantityNeeded: number
): Promise<{ slices: FefoSlice[]; shortBy: number }> {
  if (quantityNeeded <= 0) return { slices: [], shortBy: 0 };
  const sellable = await isDispatchSellableLocation(locationId);
  if (!sellable) return { slices: [], shortBy: quantityNeeded };

  const rows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: {
        orgId,
        variantId,
        expDate: fefoLotExpDateEligibleFilter(),
      },
    },
    include: { lot: { select: { id: true, expDate: true } } },
    orderBy: { lot: { expDate: "asc" } },
  });

  const lotIds = rows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, locationId),
  ]);

  const out: FefoSlice[] = [];
  let need = quantityNeeded;
  for (const row of rows) {
    if (need <= 0) break;
    if (recallFrozen.has(row.lotId)) continue;
    const qcBlock = qcPending.get(row.lotId) ?? 0;
    const effective = row.onHandQty - row.reservedQty - qcBlock;
    if (effective <= 0) continue;
    const take = Math.min(need, effective);
    if (take > 0) {
      out.push({ lotId: row.lotId, locationId, quantity: take });
      need -= take;
    }
  }

  return { slices: out, shortBy: need };
}

/** In-memory row for batch FEFO (sorted by expiry ascending per variant at location). */
export type FefoBatchRow = {
  lotId: number;
  variantId: number;
  onHandQty: number;
  reservedQty: number;
  expDate: Date | null;
};

export type FefoLocationBatchContext = {
  sellable: boolean;
  /** variantId -> rows sorted by expDate asc */
  rowsByVariant: Map<number, FefoBatchRow[]>;
  recallFrozen: Set<number>;
  qcPending: Map<number, number>;
};

/**
 * Load all FEFO-eligible lot rows for many variants at one location in a single query.
 * Used by multi-source allocator to avoid N×M round-trips.
 */
export async function batchLoadFefoContextForLocation(
  orgId: number,
  locationId: number,
  variantIds: number[]
): Promise<FefoLocationBatchContext> {
  if (variantIds.length === 0) {
    return { sellable: true, rowsByVariant: new Map(), recallFrozen: new Set(), qcPending: new Map() };
  }

  const sellable = await isDispatchSellableLocation(locationId);
  if (!sellable) {
    return { sellable: false, rowsByVariant: new Map(), recallFrozen: new Set(), qcPending: new Map() };
  }

  const uniqueVariantIds = [...new Set(variantIds)];

  const rows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: {
        orgId,
        variantId: { in: uniqueVariantIds },
        expDate: fefoLotExpDateEligibleFilter(),
      },
    },
    include: {
      lot: { select: { id: true, expDate: true, variantId: true } },
    },
  });

  const lotIds = rows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, locationId),
  ]);

  const rowsByVariant = new Map<number, FefoBatchRow[]>();
  for (const r of rows) {
    const vid = r.lot.variantId;
    if (!rowsByVariant.has(vid)) rowsByVariant.set(vid, []);
    rowsByVariant.get(vid)!.push({
      lotId: r.lotId,
      variantId: vid,
      onHandQty: r.onHandQty,
      reservedQty: r.reservedQty,
      expDate: r.lot.expDate,
    });
  }

  for (const [, list] of rowsByVariant.entries()) {
    list.sort((a, b) => {
      const ta = a.expDate ? new Date(a.expDate).getTime() : 0;
      const tb = b.expDate ? new Date(b.expDate).getTime() : 0;
      return ta - tb;
    });
  }

  return { sellable: true, rowsByVariant, recallFrozen, qcPending };
}

/**
 * FEFO slice from preloaded batch context (no DB).
 */
export function allocateVariantFifoUpToFromBatchContext(
  ctx: FefoLocationBatchContext,
  locationId: number,
  variantId: number,
  quantityNeeded: number
): { slices: FefoSlice[]; shortBy: number } {
  if (quantityNeeded <= 0) return { slices: [], shortBy: 0 };
  if (!ctx.sellable) return { slices: [], shortBy: quantityNeeded };

  const rows = ctx.rowsByVariant.get(variantId) ?? [];
  const out: FefoSlice[] = [];
  let need = quantityNeeded;

  for (const row of rows) {
    if (need <= 0) break;
    if (ctx.recallFrozen.has(row.lotId)) continue;
    const qcBlock = ctx.qcPending.get(row.lotId) ?? 0;
    const effective = row.onHandQty - row.reservedQty - qcBlock;
    if (effective <= 0) continue;
    const take = Math.min(need, effective);
    if (take > 0) {
      out.push({ lotId: row.lotId, locationId, quantity: take });
      need -= take;
    }
  }

  return { slices: out, shortBy: need };
}

/**
 * Total quantity dispatchable via FEFO lot lines (effective on-hand minus reservedQty, QC/recall exclusions).
 * Does not consider aggregate StockBalance — use with aggregate max for enterprise non-lot fallback.
 */
export async function getFefoEligibleLotTotal(
  orgId: number,
  locationId: number,
  variantId: number
): Promise<number> {
  const sellable = await isDispatchSellableLocation(locationId);
  if (!sellable) return 0;

  const rows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: {
        orgId,
        variantId,
        expDate: fefoLotExpDateEligibleFilter(),
      },
    },
    include: { lot: { select: { id: true, expDate: true } } },
    orderBy: { lot: { expDate: "asc" } },
  });

  const lotIds = rows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, locationId),
  ]);

  let sum = 0;
  for (const row of rows) {
    if (recallFrozen.has(row.lotId)) continue;
    const qcBlock = qcPending.get(row.lotId) ?? 0;
    // Subtract both reservedQty and QC hold from available
    const effective = row.onHandQty - row.reservedQty - qcBlock;
    if (effective > 0) sum += effective;
  }
  return sum;
}

/** Non-lot book balance effective qty (onHand - reserved) at a location. */
export async function getNonLotEffectiveAtLocation(locationId: number, variantId: number): Promise<number> {
  const sellable = await isDispatchSellableLocation(locationId);
  if (!sellable) return 0;
  const bal = await prisma.stockBalance.findUnique({
    where: {
      locationId_variantId: { locationId, variantId },
    },
  });
  return Math.max(0, (bal?.onHandQty ?? 0) - (bal?.reservedQty ?? 0));
}

/**
 * Single source of truth for max dispatchable at a location (max of FEFO-eligible lots vs non-lot book).
 * Used by stock request preview, validation, and diagnostics.
 */
export async function getMaxDispatchableQtyAtLocation(
  orgId: number,
  locationId: number,
  variantId: number
): Promise<number> {
  const [aggregate, lotTotal] = await Promise.all([
    getNonLotEffectiveAtLocation(locationId, variantId),
    getFefoEligibleLotTotal(orgId, locationId, variantId),
  ]);
  return Math.max(lotTotal, aggregate);
}
