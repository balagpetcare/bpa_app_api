/**
 * Phase 3: Payment gateway plugin – provider interface (per country)
 * Policy-driven gateway list; implement createIntent/capture/refund per provider.
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

export type PaymentIntentRequest = {
  amount: number; // in smallest unit or main currency
  currency: string;
  referenceId: string;
  metadata?: Record<string, string>;
};

export type PaymentIntentResult = {
  success: boolean;
  providerTxId?: string;
  redirectUrl?: string;
  clientSecret?: string;
  errorCode?: string;
  message?: string;
};

export type RefundRequest = {
  providerTxId: string;
  amount?: number;
  reason?: string;
};

export type RefundResult = {
  success: boolean;
  refundId?: string;
  errorCode?: string;
  message?: string;
};

/**
 * Per-country payment provider interface.
 * Each provider (BKASH, NAGAD, STRIPE, etc.) implements this.
 */
export interface PaymentGatewayProvider {
  providerCode: string;
  createIntent(config: Record<string, unknown>, request: PaymentIntentRequest): Promise<PaymentIntentResult>;
  capture?(config: Record<string, unknown>, providerTxId: string): Promise<{ success: boolean; errorCode?: string }>;
  refund?(config: Record<string, unknown>, request: RefundRequest): Promise<RefundResult>;
}
