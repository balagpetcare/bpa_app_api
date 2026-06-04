/**
 * Fulfillment allocation reservations: ledger-backed (RESERVE_FULFILLMENT / RELEASE_FULFILLMENT_RESERVE).
 * Controlled by env FULFILLMENT_RESERVATION_ENABLED (default: on).
 *
 * Race safety: call {@link lockStockLotBalancesForAllocation} in the same transaction
 * before reserving so concurrent confirms serialize on the same lot rows.
 */
const ledgerService = require("../inventory/ledger.service");

/**
 * Row-lock stock_lot_balances for all allocation lines (deduped) to prevent concurrent
 * double-reserve across two allocation confirms. Must run in the same transaction as reserve.
 */
export async function lockStockLotBalancesForAllocation(
  tx: any,
  lines: Array<{ locationId: number; lotId: number }>,
): Promise<void> {
  if (!lines.length) return;
  const seen = new Set<string>();
  const unique: Array<{ locationId: number; lotId: number }> = [];
  for (const l of lines) {
    const k = `${l.locationId}:${l.lotId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(l);
  }
  for (const l of unique) {
    await tx.$queryRaw`
      SELECT "locationId", "lotId", "onHandQty", "reservedQty"
      FROM stock_lot_balances
      WHERE "locationId" = ${l.locationId} AND "lotId" = ${l.lotId}
      FOR UPDATE
    `;
  }
}

export function isFulfillmentReservationEnabled(): boolean {
  const v = process.env.FULFILLMENT_RESERVATION_ENABLED;
  if (v === undefined || v === "") return true;
  return v !== "false" && v !== "0";
}

export async function reserveAllocationPlanLinesInTx(
  tx: any,
  params: {
    orgId: number;
    allocationPlanId: number;
    fromLocationId: number;
    lines: Array<{ variantId: number; lotId: number; locationId: number; quantityAllocated: number }>;
    createdByUserId?: number | null;
    /** When true, skip the single-location validation (multi-source plans). */
    multiSource?: boolean;
  }
): Promise<void> {
  if (!isFulfillmentReservationEnabled()) return;
  const refId = String(params.allocationPlanId);
  for (const line of params.lines) {
    if (line.quantityAllocated <= 0) continue;
    if (!params.multiSource && line.locationId !== params.fromLocationId) {
      throw new Error("ALLOCATION_LINE_LOCATION_MISMATCH: line location must match plan fromLocation");
    }
    await ledgerService.recordLedgerEntryInTx(tx, {
      orgId: params.orgId,
      locationId: line.locationId,
      variantId: line.variantId,
      lotId: line.lotId,
      type: "RESERVE_FULFILLMENT",
      quantityDelta: line.quantityAllocated,
      refType: "ALLOCATION_PLAN",
      refId,
      createdByUserId: params.createdByUserId ?? undefined,
    });
  }
}

export async function releaseAllocationPlanLinesInTx(
  tx: any,
  params: {
    orgId: number;
    allocationPlanId: number;
    fromLocationId: number;
    lines: Array<{ variantId: number; lotId: number; locationId: number; quantityAllocated: number }>;
    createdByUserId?: number | null;
    /** When true, skip the single-location validation (multi-source plans). */
    multiSource?: boolean;
  }
): Promise<void> {
  if (!isFulfillmentReservationEnabled()) return;
  const refId = String(params.allocationPlanId);
  for (const line of params.lines) {
    if (line.quantityAllocated <= 0) continue;
    if (!params.multiSource && line.locationId !== params.fromLocationId) {
      throw new Error("ALLOCATION_LINE_LOCATION_MISMATCH: cannot release reserve; line location must match plan fromLocation");
    }
    await ledgerService.recordLedgerEntryInTx(tx, {
      orgId: params.orgId,
      locationId: line.locationId,
      variantId: line.variantId,
      lotId: line.lotId,
      type: "RELEASE_FULFILLMENT_RESERVE",
      quantityDelta: -line.quantityAllocated,
      refType: "ALLOCATION_PLAN",
      refId,
      createdByUserId: params.createdByUserId ?? undefined,
    });
  }
}
