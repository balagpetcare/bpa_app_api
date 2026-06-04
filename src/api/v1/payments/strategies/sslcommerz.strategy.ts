import type { PaymentProviderStrategy } from "../paymentProvider.interface";
import * as ssl from "../../providers/sslcommerz.provider";
import { getRequiredEnvKeys, isSslCommerzConfigured } from "../../providers/paymentProvider.config";

export const sslCommerzStrategy: PaymentProviderStrategy = {
  code: "sslcommerz",

  isConfigured: isSslCommerzConfigured,

  validateConfig() {
    return getRequiredEnvKeys("sslcommerz").filter((k) => !process.env[k]?.trim());
  },

  createPayment: ssl.createIntent,

  async verifyPayment({ providerTxId, payload }) {
    const valId = providerTxId || (payload?.val_id as string | undefined);
    if (valId) return ssl.validateTransaction(valId);
    if (payload) {
      const body = payload as Record<string, string>;
      if (!ssl.verifyIpnSignature(body)) return null;
      return ssl.parseIpnBody(body);
    }
    return null;
  },

  async handleWebhook({ body }) {
    const record = (body || {}) as Record<string, string>;
    if (!ssl.verifyIpnSignature(record)) return null;

    const valId = record.val_id;
    if (valId) {
      const validated = await ssl.validateTransaction(valId);
      if (validated) return validated;
    }
    return ssl.parseIpnBody(record);
  },
};
