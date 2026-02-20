/**
 * Sanitize import data: strip HTML/injection from text, allow only known columns in rawData.
 * Prevents stored secrets and HTML injection in name/description.
 */
const ALLOWED_RAW_KEYS = new Set([
  "name", "product_name", "title", "product title", "product_title",
  "sku", "variant_sku", "variant sku", "code", "item_code",
  "barcode", "ean", "upc", "global_sku", "isbn",
  "price", "mrp", "mrp_price", "unit_price", "selling_price",
  "category", "category_name", "category name",
  "subcategory", "subcategory_name", "sub_category", "sub category",
  "brand", "brand_name", "brand name",
  "unit", "pack_unit", "pack unit", "uom",
  "description", "short_description", "product_description",
  "variant_name", "variant name", "variant_title", "variant title",
  "pack_size", "pack size", "size", "flavour", "flavor",
]);

const BLOCKED_PATTERNS = [
  /<script\b[^>]*>/gi,
  /<iframe\b[^>]*>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /&#x?[0-9a-f]+;/gi,
];

/** Remove HTML and dangerous patterns from a string (name/description). */
export function sanitizeText(value: string | null | undefined): string {
  if (value == null) return "";
  let s = String(value).trim();
  s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  for (const re of BLOCKED_PATTERNS) {
    s = s.replace(re, "");
  }
  return s.slice(0, 10000);
}

/** Return a copy of raw record with only allowed keys and sanitized string values. */
export function sanitizeRawData(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const keyLower = String(k).trim().toLowerCase().replace(/\s+/g, "_");
    const keyOrig = String(k).trim();
    if (!keyOrig || keyOrig.length > 200) continue;
    if (!ALLOWED_RAW_KEYS.has(keyLower) && !ALLOWED_RAW_KEYS.has(keyOrig)) continue;
    if (v == null) continue;
    const str = String(v).trim();
    if (str.length > 5000) continue;
    if (["name", "title", "product_name", "product title", "description", "short_description", "variant_name", "variant name"].some((f) => keyLower.includes(f) || keyOrig.toLowerCase().includes(f))) {
      out[keyOrig] = sanitizeText(str);
    } else {
      out[keyOrig] = str.slice(0, 500);
    }
  }
  return out;
}
