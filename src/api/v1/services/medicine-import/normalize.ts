/**
 * Normalization for medicine import keys (dedupe) vs display strings.
 */

export function normalizeKey(input: string): string {
  const s = String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return s;
}

/** Human-facing display: trim + collapse spaces; preserve case. */
export function normalizeDisplay(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}
