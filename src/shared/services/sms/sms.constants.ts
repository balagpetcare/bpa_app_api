/** BullMQ queue name for asynchronous SMS delivery. */
export const SMS_QUEUE_NAME = "smsQueue";

/** Legacy queue name — worker listens to both during migration. */
export const SMS_LEGACY_QUEUE_NAME = "notif_sms";

export const SMS_DEFAULT_ATTEMPTS = 3;
export const SMS_DEFAULT_BACKOFF_MS = 5000;
export const SMS_DEFAULT_TIMEOUT_MS = 15000;
export const SMS_BULK_MAX_RECIPIENTS = 500;

export const SMS_LEGACY_API_PATH = "/smsapi";
export const SMS_BALANCE_API_PATH = "/getBalanceApi";

export function getSmsApiMethod(): "GET" | "POST" {
  const method = String(process.env.SMS_API_METHOD || "GET").toUpperCase();
  return method === "POST" ? "POST" : "GET";
}

/** Full URL for legacy send API (GET smsapi). */
export function getSmsApiUrl(): string {
  const explicit = process.env.SMS_API_URL?.trim();
  if (explicit) return explicit;
  const legacy = process.env.BULKSMSBD_LEGACY_URL?.trim();
  if (legacy) return legacy;
  return `${getSmsBaseUrl()}${SMS_LEGACY_API_PATH}`;
}

/** Full URL for balance API. */
export function getSmsBalanceApiUrl(): string {
  const explicit = process.env.SMS_BALANCE_API_URL?.trim();
  if (explicit) return explicit;
  return `${getSmsBaseUrl()}${SMS_BALANCE_API_PATH}`;
}

export function getSmsDefaultMessageType(): string {
  return process.env.SMS_DEFAULT_TYPE?.trim() || "text";
}

export function getSmsSenderType(): string {
  return process.env.SMS_SENDER_TYPE?.trim() || "NonMask";
}

export function isSmsIpWhitelistEnabled(): boolean {
  return process.env.SMS_IP_WHITELIST_ENABLED === "true" || process.env.SMS_IP_WHITELIST_ENABLED === "1";
}

export function getSmsConfigIssues(): string[] {
  const issues: string[] = [];
  if (process.env.SMS_ENABLED === "false" || process.env.SMS_ENABLED === "0") {
    return issues;
  }

  if (!getSmsApiKey()) {
    issues.push("SMS_API_KEY (or BULKSMSBD_API_KEY / BULKSMSBD_API_TOKEN) is missing");
  }
  if (!getSmsSenderId()) {
    issues.push("SMS_SENDER_ID (or BULKSMSBD_SENDER_ID / CAMPAIGN_SMS_SENDER_ID) is missing");
  }
  return issues;
}

export function validateSmsProviderConfig(): { ok: boolean; provider: string; errors: string[] } {
  const provider = getSmsProviderName();
  const errors: string[] = [];

  if (process.env.SMS_ENABLED === "false" || process.env.SMS_ENABLED === "0") {
    return { ok: true, provider, errors: [] };
  }

  errors.push(...getSmsConfigIssues());
  return { ok: errors.length === 0, provider, errors };
}

export function formatSmsProviderNotConfiguredMessage(): string {
  const issues = getSmsConfigIssues();
  if (issues.length === 0) return "SMS provider is not configured";
  return `SMS provider is not configured (${issues.join("; ")})`;
}

export function getSmsProviderName(): string {
  return String(process.env.SMS_PROVIDER || process.env.SMS_PRIMARY_PROVIDER || "bulksmsbd").toLowerCase();
}

export function getSmsApiKey(): string | undefined {
  return (
    process.env.SMS_API_KEY ||
    process.env.BULKSMSBD_API_KEY ||
    process.env.BULKSMSBD_API_TOKEN ||
    undefined
  );
}

export function getSmsSenderId(): string | undefined {
  return (
    process.env.SMS_SENDER_ID ||
    process.env.BULKSMSBD_SENDER_ID ||
    process.env.CAMPAIGN_SMS_SENDER_ID ||
    undefined
  );
}

export function getSmsBaseUrl(): string {
  const raw =
    process.env.SMS_BASE_URL ||
    process.env.BULKSMSBD_BASE_URL ||
    "http://bulksmsbd.net/api";
  return raw.replace(/\/+$/, "");
}

export function getSmsQueueAttempts(): number {
  const n = Number(process.env.SMS_QUEUE_ATTEMPTS || SMS_DEFAULT_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? n : SMS_DEFAULT_ATTEMPTS;
}

export function getSmsQueueBackoffMs(): number {
  const n = Number(process.env.SMS_QUEUE_BACKOFF_MS || SMS_DEFAULT_BACKOFF_MS);
  return Number.isFinite(n) && n > 0 ? n : SMS_DEFAULT_BACKOFF_MS;
}

export function isSmsEnabled(): boolean {
  if (process.env.SMS_ENABLED === "false" || process.env.SMS_ENABLED === "0") return false;
  if (process.env.NODE_ENV === "test") return true;
  return Boolean(getSmsApiKey() && getSmsSenderId()) || process.env.SMS_ALLOW_MOCK === "true";
}
