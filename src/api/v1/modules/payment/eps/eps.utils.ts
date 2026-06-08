import { createHmac } from "crypto";

/** EPS HMACSHA512 (UTF-8 key, base64 digest) per gateway documentation. */
export function generateEpsHash(value: string, hashKey: string): string {
  const hmac = createHmac("sha512", Buffer.from(hashKey, "utf8"));
  hmac.update(value, "utf8");
  return hmac.digest("base64");
}

/**
 * Unique merchant transaction id — timestamp + random suffix, all numeric.
 * EPS rejects reused merchantTransactionId values ("TransactionId already used"),
 * so each initialize attempt must use a fresh value. The 4-digit random suffix
 * avoids collisions when multiple checkouts initialize in the same millisecond.
 */
export function generateEpsMerchantTransactionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${y}${m}${d}${h}${min}${s}${ms}${rand}`;
}

export function normalizeEpsPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length >= 13) return `0${digits.slice(3, 13)}`;
  if (digits.startsWith("01") && digits.length >= 11) return digits.slice(0, 11);
  return digits.slice(0, 11) || "01700000000";
}

export function mapEpsStatus(status: string | undefined): "SUCCESS" | "FAILED" | "CANCELLED" {
  const s = String(status || "").toLowerCase();
  if (s === "success") return "SUCCESS";
  if (s === "cancelled" || s === "cancel" || s === "canceled") return "CANCELLED";
  return "FAILED";
}

export function normalizeCallbackRecord(
  query?: Record<string, string>,
  body?: Record<string, unknown>
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null) record[k] = String(v);
  }
  for (const [k, v] of Object.entries(body || {})) {
    if (v != null) record[k] = String(v);
  }
  return record;
}
