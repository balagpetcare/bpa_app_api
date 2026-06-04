/**
 * Bangladesh MSISDN formatting for SMS gateways (88017XXXXXXXX).
 */
export function formatBdMsisdn(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("880") && cleaned.length >= 13) return cleaned.slice(0, 13);
  if (cleaned.startsWith("88") && cleaned.length >= 12) return cleaned;
  if (cleaned.startsWith("0") && cleaned.length === 11) return `88${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith("1")) return `880${cleaned}`;
  return cleaned;
}

export function generateCsmsId(prefix = "BPA"): string {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
}
