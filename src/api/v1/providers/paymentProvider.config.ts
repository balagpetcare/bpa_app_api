/**
 * Production payment gateway configuration.
 * Active provider selected via PAYMENT_PROVIDER env (no code change to switch).
 */

export type PaymentProviderCode = "sslcommerz" | "amarpay" | "bkash" | "nagad" | "eps";

const VALID_PROVIDERS: PaymentProviderCode[] = ["sslcommerz", "amarpay", "bkash", "nagad", "eps"];

/** EPS sandbox REST API (verified; not sandbox-pgapi.* which does not resolve). */
const EPS_SANDBOX_DEFAULT_BASE = "https://sandboxpgapi.eps.com.bd";
const EPS_PRODUCTION_DEFAULT_BASE = "https://pgapi.eps.com.bd";

const PROVIDER_DISPLAY_NAMES: Record<PaymentProviderCode, string> = {
  sslcommerz: "SSLCommerz payment gateway",
  amarpay: "AmarPay payment gateway",
  bkash: "bKash payment gateway",
  nagad: "Nagad payment gateway",
  eps: "EPS payment gateway",
};

/** Placeholder pattern from .env templates, e.g. `<sandbox_username>`. */
export function isPlaceholderEnvValue(value: string | undefined): boolean {
  const t = value?.trim();
  if (!t) return true;
  if (/^<[^>]+>$/.test(t)) return true;
  if (t === "..." || t === "changeme" || t === "your_value_here") return true;
  return false;
}

export function isRealEnvValue(value: string | undefined): boolean {
  return !isPlaceholderEnvValue(value);
}

export function getProviderDisplayName(code: PaymentProviderCode): string {
  return PROVIDER_DISPLAY_NAMES[code] || `${code} payment gateway`;
}

export function getProviderConfigIssues(code: PaymentProviderCode): string[] {
  const issues: string[] = [];

  if (code === "eps") {
    for (const key of ["EPS_USERNAME", "EPS_PASSWORD", "EPS_STORE_ID"]) {
      if (!isRealEnvValue(process.env[key])) {
        issues.push(
          !process.env[key]?.trim()
            ? `${key} is missing`
            : `${key} is a placeholder (${process.env[key]?.trim()})`
        );
      }
    }
    const epsHash =
      process.env.EPS_HASH_KEY?.trim() || process.env.EPS_HASH?.trim();
    if (!isRealEnvValue(epsHash)) {
      issues.push(
        !epsHash
          ? "EPS_HASH_KEY (or EPS_HASH) is missing"
          : "EPS_HASH_KEY (or EPS_HASH) is a placeholder"
      );
    }
    const merchant =
      process.env.EPS_MERCHANT_ID?.trim() || process.env.EPS_MERCHANTID?.trim();
    if (!isRealEnvValue(merchant)) {
      issues.push(
        !merchant
          ? "EPS_MERCHANT_ID is missing"
          : `EPS_MERCHANT_ID is a placeholder (${merchant})`
      );
    }
    if (isPlaceholderEnvValue(process.env.EPS_BASE_URL)) {
      issues.push("EPS_BASE_URL is a placeholder");
    }
    return issues;
  }

  for (const key of getRequiredEnvKeys(code)) {
    if (!isRealEnvValue(process.env[key])) {
      issues.push(
        !process.env[key]?.trim()
          ? `${key} is missing`
          : `${key} is a placeholder (${process.env[key]?.trim()})`
      );
    }
  }
  return issues;
}

export function formatProviderNotConfiguredMessage(code: PaymentProviderCode): string {
  const label = getProviderDisplayName(code);
  const issues = getProviderConfigIssues(code);
  if (issues.length === 0) {
    return `${label} is not configured`;
  }
  return `${label} is not configured (${issues.join("; ")})`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getApiPublicBaseUrl(): string {
  const base =
    process.env.API_PUBLIC_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.APP_URL ||
    "";
  return trimSlash(base);
}

/** Unified payment API prefix (Strategy Pattern entrypoint). */
export function getUnifiedPaymentApiPrefix(): string {
  return `${getApiPublicBaseUrl()}/api/v1/payments`;
}

/** @deprecated Use getUnifiedPaymentApiPrefix — kept for backward-compatible campaign callback URLs. */
export function getCampaignPaymentApiPrefix(): string {
  const override = process.env.CAMPAIGN_PAYMENT_CALLBACK_PREFIX;
  if (override) return trimSlash(override);
  return getUnifiedPaymentApiPrefix();
}

export function getActivePaymentProvider(): PaymentProviderCode {
  const raw = (process.env.PAYMENT_PROVIDER || "eps").toLowerCase().trim();
  if (VALID_PROVIDERS.includes(raw as PaymentProviderCode)) {
    return raw as PaymentProviderCode;
  }
  console.warn(
    `[Payment] Invalid PAYMENT_PROVIDER="${raw}"; falling back to eps`
  );
  return "eps";
}

export function isBkashConfigured(): boolean {
  return (
    isRealEnvValue(process.env.BKASH_APP_KEY) &&
    isRealEnvValue(process.env.BKASH_APP_SECRET) &&
    isRealEnvValue(process.env.BKASH_USERNAME) &&
    isRealEnvValue(process.env.BKASH_PASSWORD)
  );
}

export function isNagadConfigured(): boolean {
  return (
    isRealEnvValue(process.env.NAGAD_MERCHANT_ID) &&
    isRealEnvValue(process.env.NAGAD_PUBLIC_KEY) &&
    isRealEnvValue(process.env.NAGAD_PRIVATE_KEY)
  );
}

export function isSslCommerzConfigured(): boolean {
  return (
    isRealEnvValue(process.env.SSLCOMMERZ_STORE_ID) &&
    isRealEnvValue(process.env.SSLCOMMERZ_STORE_PASSWORD)
  );
}

export function isAmarPayConfigured(): boolean {
  return (
    isRealEnvValue(process.env.AMARPAY_STORE_ID) &&
    isRealEnvValue(process.env.AMARPAY_SIGNATURE_KEY)
  );
}

export function isEpsConfigured(): boolean {
  return getProviderConfigIssues("eps").length === 0;
}

export function isProviderConfigured(code: PaymentProviderCode): boolean {
  switch (code) {
    case "bkash":
      return isBkashConfigured();
    case "nagad":
      return isNagadConfigured();
    case "sslcommerz":
      return isSslCommerzConfigured();
    case "amarpay":
      return isAmarPayConfigured();
    case "eps":
      return isEpsConfigured();
    default:
      return false;
  }
}

export function getBkashConfig() {
  const sandbox = process.env.BKASH_SANDBOX !== "false";
  const prefix = getUnifiedPaymentApiPrefix();
  return {
    appKey: process.env.BKASH_APP_KEY || "",
    appSecret: process.env.BKASH_APP_SECRET || "",
    username: process.env.BKASH_USERNAME || "",
    password: process.env.BKASH_PASSWORD || "",
    baseUrl:
      process.env.BKASH_BASE_URL ||
      (sandbox
        ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta"
        : "https://tokenized.pay.bka.sh/v1.2.0-beta"),
    callbackUrl: process.env.BKASH_CALLBACK_URL || `${prefix}/webhook`,
  };
}

export function getNagadConfig() {
  const sandbox = process.env.NAGAD_SANDBOX !== "false";
  const prefix = getUnifiedPaymentApiPrefix();
  return {
    merchantId: process.env.NAGAD_MERCHANT_ID || "",
    merchantNumber: process.env.NAGAD_MERCHANT_NUMBER || "",
    privateKey: process.env.NAGAD_PRIVATE_KEY || "",
    publicKey: process.env.NAGAD_PUBLIC_KEY || "",
    baseUrl:
      process.env.NAGAD_BASE_URL ||
      (sandbox
        ? "http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0"
        : "https://api.mynagad.com:10900/remote-payment-gateway-1.0"),
    callbackUrl: process.env.NAGAD_CALLBACK_URL || `${prefix}/webhook`,
  };
}

export function getSslCommerzConfig() {
  const sandbox = process.env.SSLCOMMERZ_SANDBOX !== "false";
  const prefix = getUnifiedPaymentApiPrefix();
  return {
    storeId: process.env.SSLCOMMERZ_STORE_ID || "",
    storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD || "",
    sandbox,
    sessionUrl:
      process.env.SSLCOMMERZ_SESSION_URL ||
      (sandbox
        ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
        : "https://securepay.sslcommerz.com/gwprocess/v4/api.php"),
    validationUrl:
      process.env.SSLCOMMERZ_VALIDATION_URL ||
      (sandbox
        ? "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
        : "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php"),
    successUrl: process.env.SSLCOMMERZ_SUCCESS_URL || `${prefix}/webhook/redirect/success`,
    failUrl: process.env.SSLCOMMERZ_FAIL_URL || `${prefix}/webhook/redirect/fail`,
    cancelUrl: process.env.SSLCOMMERZ_CANCEL_URL || `${prefix}/webhook/redirect/cancel`,
    ipnUrl: process.env.SSLCOMMERZ_IPN_URL || `${prefix}/webhook`,
  };
}

export function getAmarPayConfig() {
  const sandbox = process.env.AMARPAY_SANDBOX !== "false";
  return {
    storeId: process.env.AMARPAY_STORE_ID || "",
    signatureKey: process.env.AMARPAY_SIGNATURE_KEY || "",
    sandbox,
    baseUrl:
      process.env.AMARPAY_BASE_URL ||
      (sandbox ? "https://sandbox.aamarpay.com" : "https://secure.aamarpay.com"),
    ipnUrl: process.env.AMARPAY_IPN_URL || `${getUnifiedPaymentApiPrefix()}/webhook`,
  };
}

/** Where `getEpsConfig().baseUrl` was resolved from (for startup logs). */
export function getEpsBaseUrlResolution(): {
  baseUrl: string;
  source: "EPS_BASE_URL" | "EPS_SANDBOX_DEFAULT" | "EPS_PRODUCTION_DEFAULT";
  sandbox: boolean;
} {
  const sandbox = process.env.EPS_SANDBOX !== "false";
  const envUrl = process.env.EPS_BASE_URL?.trim();
  if (envUrl && !isPlaceholderEnvValue(envUrl)) {
    return { baseUrl: envUrl, source: "EPS_BASE_URL", sandbox };
  }
  if (sandbox) {
    return { baseUrl: EPS_SANDBOX_DEFAULT_BASE, source: "EPS_SANDBOX_DEFAULT", sandbox };
  }
  return { baseUrl: EPS_PRODUCTION_DEFAULT_BASE, source: "EPS_PRODUCTION_DEFAULT", sandbox };
}

export function getEpsConfig() {
  const { baseUrl, sandbox } = getEpsBaseUrlResolution();
  const epsPrefix = `${getApiPublicBaseUrl()}/api/v1/payments/eps`;

  return {
    baseUrl,
    sandbox,
    username: process.env.EPS_USERNAME || "",
    password: process.env.EPS_PASSWORD || "",
    hashKey: process.env.EPS_HASH_KEY?.trim() || process.env.EPS_HASH?.trim() || "",
    merchantId:
      process.env.EPS_MERCHANT_ID?.trim() || process.env.EPS_MERCHANTID?.trim() || "",
    storeId: process.env.EPS_STORE_ID || "",
    successUrl:
      process.env.EPS_SUCCESS_URL ||
      `${epsPrefix}/success`,
    failUrl:
      process.env.EPS_FAIL_URL ||
      `${epsPrefix}/fail`,
    cancelUrl:
      process.env.EPS_CANCEL_URL ||
      `${epsPrefix}/cancel`,
    callbackUrl:
      process.env.EPS_CALLBACK_URL ||
      `${epsPrefix}/webhook`,
    timeoutMs: Number(process.env.EPS_TIMEOUT_MS || 30_000),
  };
}

export function getPaymentTimeoutMinutes(): number {
  const n = Number(process.env.CAMPAIGN_PAYMENT_TIMEOUT_MINUTES || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function getPaymentWebhookSecret(): string {
  return process.env.PAYMENT_WEBHOOK_SECRET || process.env.CAMPAIGN_PAYMENT_WEBHOOK_SECRET || "";
}

/** Required env keys per provider (for startup validation). */
export function getRequiredEnvKeys(code: PaymentProviderCode): string[] {
  switch (code) {
    case "bkash":
      return ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"];
    case "nagad":
      return ["NAGAD_MERCHANT_ID", "NAGAD_PUBLIC_KEY", "NAGAD_PRIVATE_KEY"];
    case "sslcommerz":
      return ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"];
    case "amarpay":
      return ["AMARPAY_STORE_ID", "AMARPAY_SIGNATURE_KEY"];
    case "eps":
      return [
        "EPS_USERNAME",
        "EPS_PASSWORD",
        "EPS_HASH_KEY",
        "EPS_STORE_ID",
        "EPS_MERCHANT_ID",
      ];
    default:
      return [];
  }
}

export function validateActivePaymentProviderConfig(): {
  ok: boolean;
  provider: PaymentProviderCode;
  errors: string[];
} {
  const provider = getActivePaymentProvider();
  const errors: string[] = [];

  if (!process.env.API_PUBLIC_BASE_URL && !process.env.BACKEND_PUBLIC_URL && !process.env.APP_URL) {
    errors.push("Set API_PUBLIC_BASE_URL (or BACKEND_PUBLIC_URL / APP_URL) for payment callback URLs");
  }

  const configIssues = getProviderConfigIssues(provider);
  if (configIssues.length > 0) {
    errors.push(formatProviderNotConfiguredMessage(provider));
  }

  return { ok: errors.length === 0, provider, errors };
}

/** Maps PAYMENT_PROVIDER env value to Prisma PaymentMethod for Order rows. */
export function mapProviderToPaymentMethod(provider: PaymentProviderCode): string {
  switch (provider) {
    case "bkash":
      return "BKASH";
    case "nagad":
      return "NAGAD";
    case "sslcommerz":
      return "CARD";
    case "amarpay":
      return "ONLINE";
    case "eps":
      return "ONLINE";
    default:
      return "ONLINE";
  }
}
