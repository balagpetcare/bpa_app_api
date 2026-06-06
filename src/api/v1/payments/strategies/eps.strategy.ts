import type { PaymentProviderStrategy } from "../paymentProvider.interface";
import * as eps from "../../providers/eps.provider";
import {
  getRequiredEnvKeys,
  isEpsConfigured,
} from "../../providers/paymentProvider.config";

export const epsStrategy: PaymentProviderStrategy = {
  code: "eps",

  isConfigured: isEpsConfigured,

  validateConfig() {
    return getRequiredEnvKeys("eps").filter((k) => !process.env[k]?.trim());
  },

  createPayment: eps.createIntent,

  async verifyPayment({ referenceId, providerTxId, query }) {
    const merchantTransactionId = String(
      referenceId ||
        query?.merchantTransactionId ||
        query?.MerchantTransactionId ||
        ""
    ).trim();
    const epsTransactionId = String(providerTxId || query?.EPSTransactionId || "").trim();
    const customerOrderId = String(
      query?.CustomerOrderId || query?.customerOrderId || ""
    ).trim();
    if (!merchantTransactionId && !epsTransactionId) return null;

    return eps.checkTransactionStatus({
      merchantTransactionId: merchantTransactionId || undefined,
      epsTransactionId: epsTransactionId || undefined,
      customerOrderId: customerOrderId || undefined,
    });
  },

  async handleWebhook({ query, body }) {
    const record: Record<string, string> = {};
    for (const [k, v] of Object.entries(query || {})) {
      if (v != null) record[k] = String(v);
    }
    for (const [k, v] of Object.entries(body || {})) {
      if (v != null) record[k] = String(v);
    }

    const merchantTransactionId =
      record.merchantTransactionId || record.MerchantTransactionId || "";
    const epsTransactionId =
      record.epsTransactionId || record.EPSTransactionId || record.EpsTransactionId;
    const customerOrderId = record.CustomerOrderId || record.customerOrderId || "";

    if (!merchantTransactionId && !epsTransactionId && !customerOrderId) return null;

    const verified = await eps.checkTransactionStatus({
      merchantTransactionId: merchantTransactionId || undefined,
      epsTransactionId: epsTransactionId || undefined,
      customerOrderId: customerOrderId || undefined,
    });
    if (verified) return verified;

    return eps.parseEpsCallbackQuery(record);
  },
};
