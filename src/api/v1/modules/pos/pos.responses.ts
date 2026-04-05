/**
 * Standardized POS API response envelopes and error codes.
 */
export const POS_ERROR_CODES = {
  BRANCH_ACCESS_DENIED: "BRANCH_ACCESS_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INVALID_CART: "INVALID_CART",
  SALE_ALREADY_FINALIZED: "SALE_ALREADY_FINALIZED",
  REFUND_NOT_ALLOWED: "REFUND_NOT_ALLOWED",
  NO_OPEN_SHIFT: "NO_OPEN_SHIFT",
  SHIFT_ALREADY_OPEN: "SHIFT_ALREADY_OPEN",
  SHIFT_ALREADY_CLOSED: "SHIFT_ALREADY_CLOSED",
  /** List price, floor, retail discount rules, or approval linkage blocked the sale */
  PRICING_GOVERNANCE: "PRICING_GOVERNANCE",
} as const;

export function sendPosError(
  res: any,
  statusCode: number,
  message: string,
  code: string = POS_ERROR_CODES.VALIDATION_ERROR
): void {
  res.status(statusCode).json({
    success: false,
    message,
    code,
  });
}

export function sendPosSuccess(res: any, statusCode: number, data: any, message?: string): void {
  res.status(statusCode).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}
