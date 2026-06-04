import {
  getActivePaymentProvider,
  getEpsBaseUrlResolution,
  getUnifiedPaymentApiPrefix,
  validateActivePaymentProviderConfig,
} from "../providers/paymentProvider.config";
import { getActivePaymentStrategy, isActiveProviderReady } from "./paymentProvider.registry";

export type PaymentBootstrapResult = {
  provider: string;
  ready: boolean;
  callbackUrl: string;
  warnings: string[];
  errors: string[];
};

/**
 * Validates env and logs active provider — call once on API startup.
 * In production, missing config throws to fail fast.
 */
export function bootstrapPaymentProvider(): PaymentBootstrapResult {
  const validation = validateActivePaymentProviderConfig();
  const provider = getActivePaymentProvider();
  const strategy = getActivePaymentStrategy();
  const callbackUrl = `${getUnifiedPaymentApiPrefix()}/webhook`;
  const warnings: string[] = [];

  if (!process.env.PAYMENT_PROVIDER) {
    warnings.push(`PAYMENT_PROVIDER not set; defaulting to "${provider}"`);
  }

  const configured = validation.ok && isActiveProviderReady();
  if (provider === "eps") {
    const eps = getEpsBaseUrlResolution();
    console.log(
      `[Payment] EPS gateway: baseUrl=${eps.baseUrl} | sandbox=${eps.sandbox ? "enabled" : "disabled"} | source=${eps.source}`
    );
    if (eps.baseUrl.includes("sandbox-pgapi")) {
      console.warn(
        "[Payment] EPS baseUrl uses sandbox-pgapi.eps.com.bd — that hostname does not resolve. Set EPS_BASE_URL=https://sandboxpgapi.eps.com.bd"
      );
    }
  }

  if (configured) {
    console.log(`[Payment] Active provider: ${provider}`);
    console.log(`[Payment] Webhook base: ${callbackUrl} | configured: yes`);
  } else {
    const msg = `[Payment] Active provider: ${provider} | NOT ready: ${validation.errors.join("; ")}`;
    if (process.env.NODE_ENV === "production") {
      console.error(msg);
      throw new Error(msg);
    }
    console.warn(msg);
  }

  const missingOptional = strategy.validateConfig();
  if (missingOptional.length > 0 && validation.ok) {
    warnings.push(`Optional config gaps: ${missingOptional.join(", ")}`);
  }

  return {
    provider,
    ready: validation.ok && isActiveProviderReady(),
    callbackUrl,
    warnings,
    errors: validation.errors,
  };
}
