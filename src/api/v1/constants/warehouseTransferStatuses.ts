/**
 * Warehouse Transfer Order Status Constants
 *
 * Single source of truth for WarehouseTransferOrderStatus enum values.
 * These must match the Prisma schema enum WarehouseTransferOrderStatus exactly.
 *
 * Schema enum values (prisma/schema.prisma):
 *   DRAFT, APPROVED, PICKING, IN_TRANSIT, RECEIVED, CLOSED
 */

/** Valid WarehouseTransferOrderStatus enum values from Prisma schema */
export const WarehouseTransferOrderStatusValues = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  PICKING: "PICKING",
  IN_TRANSIT: "IN_TRANSIT",
  RECEIVED: "RECEIVED",
  CLOSED: "CLOSED",
} as const;

export type WarehouseTransferOrderStatusType =
  typeof WarehouseTransferOrderStatusValues[keyof typeof WarehouseTransferOrderStatusValues];

/**
 * Open/active transfer orders - not yet completed or closed.
 * Used for dashboard counts, active queue displays.
 */
export const OPEN_TRANSFER_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.DRAFT,
  WarehouseTransferOrderStatusValues.APPROVED,
  WarehouseTransferOrderStatusValues.PICKING,
  WarehouseTransferOrderStatusValues.IN_TRANSIT,
];

/**
 * Transfer orders that are in transit (picked and dispatched, awaiting receipt).
 */
export const IN_TRANSIT_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.IN_TRANSIT,
];

/**
 * Terminal/completed statuses - no further action needed.
 */
export const CLOSED_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.RECEIVED,
  WarehouseTransferOrderStatusValues.CLOSED,
];

/**
 * Statuses where picking action is allowed.
 */
export const PICKABLE_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.APPROVED,
];

/**
 * Statuses where dispatch action is allowed.
 */
export const DISPATCHABLE_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.APPROVED,
  WarehouseTransferOrderStatusValues.PICKING,
];

/**
 * Statuses where receive action is allowed.
 */
export const RECEIVABLE_STATUSES: WarehouseTransferOrderStatusType[] = [
  WarehouseTransferOrderStatusValues.IN_TRANSIT,
];

/** Helper: Check if status is an open/active transfer */
export function isOpenTransferStatus(status: string): boolean {
  return OPEN_TRANSFER_STATUSES.includes(status as WarehouseTransferOrderStatusType);
}

/** Helper: Check if status is in transit */
export function isInTransitStatus(status: string): boolean {
  return IN_TRANSIT_STATUSES.includes(status as WarehouseTransferOrderStatusType);
}

/** Helper: Check if status is terminal/closed */
export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.includes(status as WarehouseTransferOrderStatusType);
}

module.exports = {
  WarehouseTransferOrderStatusValues,
  OPEN_TRANSFER_STATUSES,
  IN_TRANSIT_STATUSES,
  CLOSED_STATUSES,
  PICKABLE_STATUSES,
  DISPATCHABLE_STATUSES,
  RECEIVABLE_STATUSES,
  isOpenTransferStatus,
  isInTransitStatus,
  isClosedStatus,
};
