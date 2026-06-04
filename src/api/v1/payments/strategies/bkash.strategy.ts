import type { PaymentProviderStrategy } from "../paymentProvider.interface";
import * as bkash from "../../providers/bkash.provider";
import { isBkashConfigured } from "../../providers/paymentProvider.config";
import { getRequiredEnvKeys } from "../../providers/paymentProvider.config";

export const bkashStrategy: PaymentProviderStrategy = {
  code: "bkash",

  isConfigured: isBkashConfigured,

  validateConfig() {
    return getRequiredEnvKeys("bkash").filter((k) => !process.env[k]?.trim());
  },

  createPayment: bkash.createIntent,

  async verifyPayment({ providerTxId, query }) {
    const paymentId = providerTxId || query?.paymentID || query?.paymentId;
    if (!paymentId) return null;
    return bkash.executePayment(paymentId);
  },

  async handleWebhook({ query }) {
    const paymentId = query?.paymentID || query?.paymentId;
    const status = query?.status;
    if (!paymentId) return null;

    if (status && status !== "success") {
      const orderRef = query.merchantInvoice || query.merchantInvoiceNumber;
      if (!orderRef) return null;
      return {
        provider: "bkash",
        transactionId: String(orderRef),
        providerTxId: paymentId,
        status: "CANCELLED",
        amount: 0,
        eventId: `bkash:cancel:${paymentId}`,
      };
    }

    const verified = await bkash.executePayment(paymentId);
    if (verified && !verified.transactionId) {
      verified.transactionId = String(
        query?.merchantInvoiceNumber || query?.merchantInvoice || ""
      );
    }
    return verified;
  },

  refund: bkash.refund,
};
