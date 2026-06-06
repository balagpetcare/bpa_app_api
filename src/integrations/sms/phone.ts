/**
 * Bangladesh MSISDN formatting for SMS gateways (default country code 880).
 */
export function getDefaultCountryCode(): string {
  const raw = process.env.SMS_DEFAULT_COUNTRY_CODE?.trim() || "880";
  return raw.replace(/\D/g, "") || "880";
}

export function formatBdMsisdn(phone: string): string {
  const cc = getDefaultCountryCode();
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith(cc) && cleaned.length >= cc.length + 10) {
    return cleaned.slice(0, cc.length + 10);
  }
  if (cleaned.startsWith("880") && cleaned.length >= 13) return cleaned.slice(0, 13);
  if (cleaned.startsWith("88") && cleaned.length >= 12) return cleaned;
  if (cleaned.startsWith("0") && cleaned.length === 11) return `${cc}${cleaned.slice(1)}`;
  if (cleaned.length === 10 && cleaned.startsWith("1")) return `${cc}${cleaned}`;
  return cleaned;
}

export function generateCsmsId(prefix = "BPA"): string {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
}
