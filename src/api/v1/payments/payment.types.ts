import type { PaymentIntentRequest, PaymentIntentResponse, VerifiedPaymentEvent } from "../providers/paymentProvider.types";

export type PaymentProviderCode = "sslcommerz" | "amarpay" | "bkash" | "nagad" | "eps";

export type CreatePaymentInput = PaymentIntentRequest & {
  orderId?: number;
  idempotencyKey?: string;
};

export type CreatePaymentResult = PaymentIntentResponse & {
  provider: PaymentProviderCode;
  logId?: number;
  paymentTransactionId?: number;
};

export type VerifyPaymentInput = {
  referenceId: string;
  providerTxId?: string;
  /** Raw provider payload for webhook-style verify */
  payload?: Record<string, unknown>;
  query?: Record<string, string>;
};

export type VerifyPaymentResult = {
  success: boolean;
  provider: PaymentProviderCode;
  event?: VerifiedPaymentEvent;
  error?: string;
  logId?: number;
};

export type WebhookHandleInput = {
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
};

export type WebhookHandleResult = {
  success: boolean;
  duplicate?: boolean;
  replay?: boolean;
  bookingId?: number;
  error?: string;
};
