/**
 * Map CSV row keys (flexible headers) to canonical field strings.
 */

/** Coerce parsed CSV / JSON row cells to trimmed strings (handles numeric cells from parsers). */
export function coerceMedicineImportRow(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) out[k] = "";
    else if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else out[k] = JSON.stringify(v);
  }
  return out;
}

function headerMap(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const nk = String(k)
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    out[nk] = String(v ?? "").trim();
  }
  return out;
}

function pick(h: Record<string, string>, ...aliases: string[]): string {
  for (const a of aliases) {
    const key = a.toLowerCase().replace(/[\s_-]/g, "");
    if (h[key] !== undefined && h[key] !== "") return h[key];
  }
  return "";
}

export type RawMedicineFields = {
  genericName: string;
  brandName: string;
  packageMark: string;
  dosageType: string;
  strength: string;
  manufacturer: string;
};

export function extractMedicineFields(row: Record<string, string>): RawMedicineFields {
  const h = headerMap(row);
  return {
    genericName: pick(h, "genericname", "generic", "drugname", "molecule"),
    brandName: pick(h, "brandname", "brand", "tradename"),
    packageMark: pick(h, "packagemark", "package", "pack", "mark"),
    dosageType: pick(h, "dosagetype", "dosageform", "dosage", "form", "type"),
    strength: pick(h, "strength", "potency", "dose"),
    manufacturer: pick(h, "manufacturer", "mfr", "maker", "company"),
  };
}
