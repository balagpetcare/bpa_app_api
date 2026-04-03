/** Ledger types counted as outbound consumption for simple demand forecasting */
export const DEMAND_LEDGER_TYPES = [
  "SALE_POS",
  "SALE_CLINIC",
  "SALE_ONLINE",
  "TRANSFER_OUT",
] as const;

export const DEFAULT_WINDOW_DAYS = 90;
export const DEFAULT_HORIZON_DAYS = 14;
export const DEFAULT_LEAD_TIME_DAYS = 7;
export const DEFAULT_SAFETY_DAYS = 7;
/** One-sided normal z for ~95% in-stock probability (reorder safety extension). */
export const DEFAULT_SERVICE_LEVEL_Z = 1.65;
/** Minimum weekly buckets required to use demand std-dev in safety stock. */
export const MIN_WEEKS_FOR_DEMAND_VARIANCE = 4;
