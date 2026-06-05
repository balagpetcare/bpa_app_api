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
