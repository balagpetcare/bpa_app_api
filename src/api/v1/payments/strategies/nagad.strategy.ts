import type { PaymentProviderStrategy } from "../paymentProvider.interface";
import * as nagad from "../../providers/nagad.provider";
import { getRequiredEnvKeys, isNagadConfigured } from "../../providers/paymentProvider.config";

export const nagadStrategy: PaymentProviderStrategy = {
  code: "nagad",

  isConfigured: isNagadConfigured,

  validateConfig() {
    return getRequiredEnvKeys("nagad").filter((k) => !process.env[k]?.trim());
  },

  createPayment: nagad.createIntent,

  async verifyPayment({ payload }) {
    if (!payload) return null;
    const sig = nagad.verifyCallbackSignature({
      sensitiveData: payload.sensitiveData as string | undefined,
      signature: payload.signature as string | undefined,
    });
    if (!sig.ok || !sig.data) return null;
    return nagad.parseVerifiedCallback(sig.data);
  },

  async handleWebhook({ body }) {
    const sig = nagad.verifyCallbackSignature({
      sensitiveData: body?.sensitiveData as string | undefined,
      signature: body?.signature as string | undefined,
    });
    if (!sig.ok || !sig.data) return null;
    return nagad.parseVerifiedCallback(sig.data);
  },
};
