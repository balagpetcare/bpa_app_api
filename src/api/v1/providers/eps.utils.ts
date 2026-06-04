import { createHmac } from "crypto";

/** EPS HMACSHA512 (UTF-8 key, base64 digest) per gateway documentation. */
export function generateEpsHash(value: string, hashKey: string): string {
  const hmac = createHmac("sha512", Buffer.from(hashKey, "utf8"));
  hmac.update(value, "utf8");
  return hmac.digest("base64");
}

/** Unique merchant transaction id (min 10 digits) — timestamp-based. */
export function generateEpsMerchantTransactionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}${h}${min}${s}${ms}`;
}

export function normalizeEpsPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length >= 13) return `0${digits.slice(3, 13)}`;
  if (digits.startsWith("01") && digits.length >= 11) return digits.slice(0, 11);
  return digits.slice(0, 11) || "01700000000";
}
