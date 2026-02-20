/**
 * Universal Product Import – normalize keys/values (trim, casefold, units).
 */
import type { NormalizedProductRow } from "./types";

const ALIASES: Record<string, string[]> = {
  name: ["name", "product_name", "product name", "title", "product title", "product_title"],
  sku: ["sku", "variant_sku", "variant sku", "code", "item_code"],
  barcode: ["barcode", "ean", "upc", "global_sku", "isbn"],
  price: ["price", "mrp", "mrp_price", "unit_price", "selling_price"],
  category: ["category", "category_name", "category name"],
  subcategory: ["subcategory", "subcategory_name", "sub_category", "sub category"],
  brand: ["brand", "brand_name", "brand name"],
  unit: ["unit", "pack_unit", "pack unit", "uom"],
  description: ["description", "short_description", "product_description"],
  variantTitle: ["variant_name", "variant name", "variant_title", "variant title"],
};

function getValue(row: Record<string, string>, keys: string[]): string {
  const rawKeys = Object.keys(row);
  for (const key of keys) {
    const found = rawKeys.find((k) => k.toLowerCase().trim() === key.toLowerCase());
    if (found && row[found] != null && String(row[found]).trim() !== "") {
      return String(row[found]).trim();
    }
  }
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
}

function normalizeString(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_NORMALIZE: Record<string, string> = {
  kg: "kg",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  l: "L",
  liter: "L",
  litre: "L",
  ml: "ml",
  mlr: "ml",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  pack: "pack",
  box: "box",
  bag: "bag",
};

function normalizeUnit(raw: string): string {
  const key = raw.toLowerCase().trim();
  return UNIT_NORMALIZE[key] ?? key;
}

function parseNumber(val: string): number | undefined {
  const cleaned = val.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Produce normalized row with canonical keys and cleaned values.
 */
export function normalizeRow(raw: Record<string, string>): NormalizedProductRow {
  const out: NormalizedProductRow = {};

  const name = getValue(raw, ALIASES.name);
  if (name) out.name = normalizeString(name);

  const sku = getValue(raw, ALIASES.sku);
  if (sku) out.sku = normalizeString(sku);

  const barcode = getValue(raw, ALIASES.barcode);
  if (barcode) out.barcode = normalizeString(barcode);

  const priceRaw = getValue(raw, ALIASES.price);
  if (priceRaw) {
    const p = parseNumber(priceRaw);
    if (p !== undefined) out.price = p;
  }

  const category = getValue(raw, ALIASES.category);
  if (category) out.category = normalizeString(category);

  const subcategory = getValue(raw, ALIASES.subcategory);
  if (subcategory) out.subcategory = normalizeString(subcategory);

  const brand = getValue(raw, ALIASES.brand);
  if (brand) out.brand = normalizeString(brand);

  const unit = getValue(raw, ALIASES.unit);
  if (unit) out.unit = normalizeUnit(unit);

  const description = getValue(raw, ALIASES.description);
  if (description) out.description = normalizeString(description);

  const variantTitle = getValue(raw, ALIASES.variantTitle);
  if (variantTitle) out.variantTitle = normalizeString(variantTitle);

  return out;
}
