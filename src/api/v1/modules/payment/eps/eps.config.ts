import {
  formatProviderNotConfiguredMessage,
  getApiPublicBaseUrl,
  getEpsBaseUrlResolution,
  getUnifiedPaymentApiPrefix,
  isPlaceholderEnvValue,
  isRealEnvValue,
} from "../../../providers/paymentProvider.config";

export type EpsConfig = {
  baseUrl: string;
  sandbox: boolean;
  username: string;
  password: string;
  hashKey: string;
  merchantId: string;
  storeId: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  timeoutMs: number;
};

/** EPS hash key — prefer EPS_HASH_KEY; EPS_HASH kept for backward compatibility. */
export function getEpsHashKey(): string {
  return (
    process.env.EPS_HASH_KEY?.trim() ||
    process.env.EPS_HASH?.trim() ||
    ""
  );
}

export function getEpsModuleConfig(): EpsConfig {
  const { baseUrl, sandbox } = getEpsBaseUrlResolution();
  const prefix = getUnifiedPaymentApiPrefix();

  return {
    baseUrl,
    sandbox,
    username: process.env.EPS_USERNAME?.trim() || "",
    password: process.env.EPS_PASSWORD?.trim() || "",
    hashKey: getEpsHashKey(),
    merchantId:
      process.env.EPS_MERCHANT_ID?.trim() ||
      process.env.EPS_MERCHANTID?.trim() ||
      "",
    storeId: process.env.EPS_STORE_ID?.trim() || "",
    successUrl:
      process.env.EPS_SUCCESS_URL?.trim() ||
      `${prefix}/payment/eps/callback/success`,
    failUrl:
      process.env.EPS_FAIL_URL?.trim() ||
      `${prefix}/payment/eps/callback/fail`,
    cancelUrl:
      process.env.EPS_CANCEL_URL?.trim() ||
      `${prefix}/payment/eps/callback/cancel`,
    timeoutMs: Number(process.env.EPS_TIMEOUT_MS || 30_000),
  };
}

export function getEpsConfigIssues(): string[] {
  const issues: string[] = [];
  for (const key of ["EPS_USERNAME", "EPS_PASSWORD", "EPS_STORE_ID"]) {
    if (!isRealEnvValue(process.env[key])) {
      issues.push(
        !process.env[key]?.trim()
          ? `${key} is missing`
          : `${key} is a placeholder`
      );
    }
  }

  const hashKey = getEpsHashKey();
  if (!isRealEnvValue(hashKey)) {
    issues.push(
      !hashKey
        ? "EPS_HASH_KEY (or EPS_HASH) is missing"
        : "EPS_HASH_KEY (or EPS_HASH) is a placeholder"
    );
  }

  const merchant =
    process.env.EPS_MERCHANT_ID?.trim() || process.env.EPS_MERCHANTID?.trim();
  if (!isRealEnvValue(merchant)) {
    issues.push(
      !merchant ? "EPS_MERCHANT_ID is missing" : "EPS_MERCHANT_ID is a placeholder"
    );
  }

  if (isPlaceholderEnvValue(process.env.EPS_BASE_URL)) {
    issues.push("EPS_BASE_URL is a placeholder");
  }

  if (!getApiPublicBaseUrl()) {
    issues.push("Set API_PUBLIC_BASE_URL for EPS callback URLs");
  }

  return issues;
}

export function isEpsModuleConfigured(): boolean {
  return getEpsConfigIssues().length === 0;
}

export function assertEpsConfigured(): EpsConfig {
  if (!isEpsModuleConfigured()) {
    throw new Error(formatProviderNotConfiguredMessage("eps"));
  }
  return getEpsModuleConfig();
}
