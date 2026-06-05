export type EpsTokenResponse = {
  token?: string;
  expireDate?: string;
  errorMessage?: string;
  errorCode?: string;
};

export type EpsInitializeResponse = {
  TransactionId?: string;
  RedirectURL?: string;
  ErrorMessage?: string;
  ErrorCode?: string;
};

export type EpsVerifyResponse = {
  MerchantTransactionId?: string;
  EPSTransactionId?: string;
  EpsTransactionId?: string;
  Status?: string;
  TotalAmount?: string;
  ErrorMessage?: string;
  ErrorCode?: string;
};

export type EpsPaymentStatus = "SUCCESS" | "FAILED" | "CANCELLED";

export type EpsVerifiedEvent = {
  provider: "eps";
  transactionId: string;
  providerTxId: string;
  status: EpsPaymentStatus;
  amount: number;
  eventId: string;
  rawResponse?: Record<string, unknown>;
};

export type EpsInitiateInput = {
  referenceId: string;
  amount: number;
  returnUrl?: string;
  cancelUrl?: string;
  bookingId?: number;
  metadata?: {
    merchantTransactionId?: string;
    phone?: string;
    name?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    postcode?: string;
    description?: string;
    orderId?: string;
    ipAddress?: string;
  };
};

export type EpsInitiateResult = {
  success: boolean;
  paymentUrl?: string;
  transactionId?: string;
  merchantTransactionId?: string;
  paymentTransactionId?: number;
  message?: string;
};

export type EpsCallbackQuery = Record<string, string>;
