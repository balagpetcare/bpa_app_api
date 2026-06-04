import type { PaymentProviderStrategy } from "../paymentProvider.interface";
import * as amarpay from "../../providers/amarpay.provider";
import { getAmarPayConfig, getRequiredEnvKeys, isAmarPayConfigured } from "../../providers/paymentProvider.config";

export const amarpayStrategy: PaymentProviderStrategy = {
  code: "amarpay",

  isConfigured: isAmarPayConfigured,

  validateConfig() {
    return getRequiredEnvKeys("amarpay").filter((k) => !process.env[k]?.trim());
  },

  createPayment: amarpay.createIntent,

  async verifyPayment({ referenceId, providerTxId }) {
    const tranId = providerTxId || referenceId;
    return amarpay.searchTransaction(tranId);
  },

  async handleWebhook({ body }) {
    const record: Record<string, string> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v != null) record[k] = String(v);
    }
    const cfg = getAmarPayConfig();
    if (!amarpay.verifyIpnSignature(record, cfg.signatureKey)) return null;

    const parsed = amarpay.parseIpnBody(record);
    if (parsed?.status === "SUCCESS" && parsed.transactionId) {
      const confirmed = await amarpay.searchTransaction(parsed.transactionId);
      if (confirmed) return confirmed;
    }
    return parsed;
  },
};
