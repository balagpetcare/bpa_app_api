/**
 * @deprecated Import from `modules/payment/eps/eps.gateway` for new code.
 * Thin re-export layer kept for unified payment strategy compatibility.
 */
import {
  clearEpsTokenCache,
  getEpsAuthToken,
  initializeEpsPayment,
  parseEpsCallbackQuery,
  verifyEpsTransaction,
} from "../modules/payment/eps/eps.gateway";
import { isEpsModuleConfigured } from "../modules/payment/eps/eps.config";
import type {
  PaymentIntentRequest,
  PaymentIntentResponse,
  VerifiedPaymentEvent,
} from "./paymentProvider.types";

export { clearEpsTokenCache, getEpsAuthToken };

export async function createIntent(req: PaymentIntentRequest): Promise<PaymentIntentResponse> {
  if (!isEpsModuleConfigured()) {
    const { formatProviderNotConfiguredMessage } = require("./paymentProvider.config");
    return { success: false, message: formatProviderNotConfiguredMessage("eps") };
  }
  return initializeEpsPayment(req);
}

export async function checkTransactionStatus(input: {
  merchantTransactionId?: string;
  epsTransactionId?: string;
}): Promise<VerifiedPaymentEvent | null> {
  if (!isEpsModuleConfigured()) return null;
  return verifyEpsTransaction(input);
}

export { parseEpsCallbackQuery };

export function isConfigured(): boolean {
  return isEpsModuleConfigured();
}
