import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentRefundRequest,
  PaymentRefundResponse,
  VerifiedPaymentEvent,
} from "../providers/paymentProvider.types";
import type { PaymentProviderCode, WebhookHandleInput } from "./payment.types";

/**
 * Strategy interface — each gateway implements this contract.
 */
export interface PaymentProviderStrategy {
  readonly code: PaymentProviderCode;

  isConfigured(): boolean;

  /** Returns list of missing/invalid env keys (empty = valid). */
  validateConfig(): string[];

  createPayment(request: PaymentIntentRequest): Promise<PaymentIntentResponse>;

  verifyPayment(input: {
    referenceId: string;
    providerTxId?: string;
    payload?: Record<string, unknown>;
    query?: Record<string, string>;
  }): Promise<VerifiedPaymentEvent | null>;

  handleWebhook(input: WebhookHandleInput): Promise<VerifiedPaymentEvent | null>;

  refund?(request: PaymentRefundRequest): Promise<PaymentRefundResponse>;
}
