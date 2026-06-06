export type PaymentIntentRequest = {
  amount: number;
  currency: string;
  referenceId: string;
  metadata?: Record<string, string>;
  returnUrl: string;
  cancelUrl?: string;
};

export type PaymentIntentResponse = {
  success: boolean;
  redirectUrl?: string;
  providerPaymentId?: string;
  message?: string;
  metadata?: Record<string, string>;
};

export type PaymentRefundRequest = {
  providerTxId: string;
  amount: number;
  reason?: string;
};

export type PaymentRefundResponse = {
  success: boolean;
  refundId?: string;
  message?: string;
};

export type VerifiedPaymentEvent = {
  provider: string;
  transactionId: string;
  providerTxId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  amount: number;
  eventId: string;
  rawResponse?: Record<string, unknown>;
};
