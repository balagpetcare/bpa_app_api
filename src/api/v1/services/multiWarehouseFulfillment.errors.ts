/**
 * Stable error codes and user-facing messages for multi-warehouse fulfillment APIs.
 * Controllers map thrown errors to HTTP status + this shape for consistent UX.
 */

export const MW_CODES = {
  MULTI_SOURCE_DISABLED: "MULTI_SOURCE_DISABLED",
  NO_WAREHOUSE_SOURCES: "NO_WAREHOUSE_SOURCES",
  PLAN_NOT_FOUND: "PLAN_NOT_FOUND",
  PLAN_WRONG_ORG: "PLAN_WRONG_ORG",
  PLAN_STATUS_INVALID: "PLAN_STATUS_INVALID",
  PLAN_VERSION_CONFLICT: "PLAN_VERSION_CONFLICT",
  NO_LINES_TO_CONFIRM: "NO_LINES_TO_CONFIRM",
  STOCK_REQUEST_NOT_FOUND: "STOCK_REQUEST_NOT_FOUND",
  STOCK_REQUEST_STATUS_INVALID: "STOCK_REQUEST_STATUS_INVALID",
  DUPLICATE_PLAN: "DUPLICATE_PLAN",
  LOCATION_NOT_FOUND: "LOCATION_NOT_FOUND",
  RESERVE_INSUFFICIENT: "RESERVE_INSUFFICIENT",
  CONCURRENT_MODIFICATION: "CONCURRENT_MODIFICATION",
} as const;

export type MwErrorCode = (typeof MW_CODES)[keyof typeof MW_CODES];

const USER_MESSAGES: Record<string, string> = {
  [MW_CODES.MULTI_SOURCE_DISABLED]:
    "Multi-warehouse allocation is not enabled for this environment. Ask an administrator to enable MULTI_SOURCE_ALLOCATION_ENABLED.",
  [MW_CODES.NO_WAREHOUSE_SOURCES]:
    "No active warehouse locations are available to source stock. Check that warehouses and inventory locations are set up.",
  [MW_CODES.PLAN_NOT_FOUND]: "Allocation plan was not found or you do not have access.",
  [MW_CODES.PLAN_WRONG_ORG]: "Allocation plan does not belong to your organization.",
  [MW_CODES.PLAN_STATUS_INVALID]: "This action is not allowed for the plan in its current status. Refresh and try again.",
  [MW_CODES.PLAN_VERSION_CONFLICT]:
    "The plan was updated by someone else. Refresh the page and retry your action.",
  [MW_CODES.NO_LINES_TO_CONFIRM]:
    "There is nothing allocated to confirm. Run allocation or add lines first.",
  [MW_CODES.STOCK_REQUEST_NOT_FOUND]: "Stock request was not found.",
  [MW_CODES.STOCK_REQUEST_STATUS_INVALID]: "The stock request is not in a state that allows allocation.",
  [MW_CODES.DUPLICATE_PLAN]: "An allocation plan already exists for this stock request.",
  [MW_CODES.LOCATION_NOT_FOUND]: "The selected location was not found in your organization.",
  [MW_CODES.RESERVE_INSUFFICIENT]:
    "Not enough stock is available to reserve (another process may have taken it). Refresh and re-run allocation.",
  [MW_CODES.CONCURRENT_MODIFICATION]: "Another operation updated inventory at the same time. Please retry.",
};

export class MultiWarehouseFulfillmentError extends Error {
  readonly code: MwErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: MwErrorCode,
    options?: { message?: string; httpStatus?: number; details?: Record<string, unknown> }
  ) {
    super(options?.message ?? USER_MESSAGES[code] ?? code);
    this.name = "MultiWarehouseFulfillmentError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? 400;
    this.details = options?.details;
  }
}

export function userMessageForCode(code: string): string {
  return USER_MESSAGES[code] ?? "Something went wrong. Please try again or contact support.";
}

export function parseMultiWarehouseError(err: unknown): {
  message: string;
  code: string | null;
  httpStatus: number;
  details?: Record<string, unknown>;
} {
  if (err instanceof MultiWarehouseFulfillmentError) {
    return {
      message: err.message,
      code: err.code,
      httpStatus: err.httpStatus,
      details: err.details,
    };
  }
  const e = err as Error & { code?: string };
  const msg = e?.message ?? String(err);
  if (msg.includes("MULTI_SOURCE") || msg.includes("multi-warehouse")) {
    return { message: userMessageForCode(MW_CODES.MULTI_SOURCE_DISABLED), code: MW_CODES.MULTI_SOURCE_DISABLED, httpStatus: 400 };
  }
  if (msg.includes("modified by another process") || msg.includes("version")) {
    return { message: userMessageForCode(MW_CODES.PLAN_VERSION_CONFLICT), code: MW_CODES.PLAN_VERSION_CONFLICT, httpStatus: 409 };
  }
  if (msg.includes("Insufficient lot stock") || msg.includes("Insufficient effective stock")) {
    return { message: userMessageForCode(MW_CODES.RESERVE_INSUFFICIENT), code: MW_CODES.RESERVE_INSUFFICIENT, httpStatus: 409 };
  }
  return { message: msg, code: e?.code ?? null, httpStatus: 400 };
}
