/**
 * Fulfillment allocation reservations: ledger-backed (RESERVE_FULFILLMENT / RELEASE_FULFILLMENT_RESERVE).
 * Controlled by env FULFILLMENT_RESERVATION_ENABLED (default: on).
 */
const ledgerService = require("../inventory/ledger.service");

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
  }
): Promise<void> {
  if (!isFulfillmentReservationEnabled()) return;
  const refId = String(params.allocationPlanId);
  for (const line of params.lines) {
    if (line.quantityAllocated <= 0) continue;
    if (line.locationId !== params.fromLocationId) {
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
  }
): Promise<void> {
  if (!isFulfillmentReservationEnabled()) return;
  const refId = String(params.allocationPlanId);
  for (const line of params.lines) {
    if (line.quantityAllocated <= 0) continue;
    if (line.locationId !== params.fromLocationId) continue;
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
