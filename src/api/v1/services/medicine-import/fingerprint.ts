import { createHash } from "crypto";
import type { NormalizedMedicineRow } from "./types";

/**
 * Stable idempotent key for country-scoped catalog line (normalized components).
 */
export function buildImportFingerprint(countryId: number, n: NormalizedMedicineRow): string {
  const payload = [
    countryId,
    n.genericKey,
    n.dosageFormKey,
    n.strengthKey,
    n.manufacturerKey,
    n.brandKey,
    n.packageKey,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
