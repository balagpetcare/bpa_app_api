/**
 * Inventory error codes for API responses.
 * Use these for consistent error handling and client-side mapping.
 */
export const INVENTORY_ERROR_CODES = {
  LOT_EXPIRED: "LOT_EXPIRED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  LOT_REQUIRED: "LOT_REQUIRED",
  INVALID_LOT: "INVALID_LOT",
} as const;
