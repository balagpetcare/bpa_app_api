/**
 * Structured debug logging for public checkout — developer logs only.
 */

type LogPayload = Record<string, unknown> | undefined;

function safeJson(payload: LogPayload): string {
  if (!payload) return "";
  try {
    return JSON.stringify(payload);
  } catch {
    return "[unserializable]";
  }
}

export function checkoutInitDebug(message: string, payload?: LogPayload): void {
  console.info(`[CHECKOUT_INIT_DEBUG] ${message}`, safeJson(payload));
}

export function paymentRetryDebug(message: string, payload?: LogPayload): void {
  console.info(`[PAYMENT_RETRY_DEBUG] ${message}`, safeJson(payload));
}

export function bookingValidationDebug(message: string, payload?: LogPayload): void {
  console.info(`[BOOKING_VALIDATION_DEBUG] ${message}`, safeJson(payload));
}

export function publicErrorHandlerDebug(message: string, payload?: LogPayload): void {
  console.info(`[PUBLIC_ERROR_HANDLER] ${message}`, safeJson(payload));
}
