import { MEDICINE_IMPORT_ISSUES, type MedicineImportIssue } from "../../constants/medicineImportIssueCodes";
import { coerceMedicineImportRow, extractMedicineFields } from "./extractRaw";
import { normalizeDisplay, normalizeKey } from "./normalize";
import { buildImportFingerprint } from "./fingerprint";
import type { NormalizedMedicineRow, RowParseResult } from "./types";

function validateAndBuild(raw: Record<string, string>, countryId: number): RowParseResult {
  const f = extractMedicineFields(raw);
  const issues: MedicineImportIssue[] = [];

  const genericDisplay = normalizeDisplay(f.genericName);
  const brandDisplay = normalizeDisplay(f.brandName);
  const dosageFormDisplay = normalizeDisplay(f.dosageType);
  const strengthDisplay = normalizeDisplay(f.strength);
  const manufacturerDisplay = normalizeDisplay(f.manufacturer);
  const packageMarkDisplay = normalizeDisplay(f.packageMark);

  if (!genericDisplay) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.MISSING_GENERIC,
      field: "genericName",
      severity: "blocking",
      message: "Generic name is required",
    });
  } else if (genericDisplay.length < 2) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.GENERIC_TOO_SHORT,
      field: "genericName",
      severity: "warning",
      message: "Generic name is very short",
    });
  }

  if (!brandDisplay) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.MISSING_BRAND,
      field: "brandName",
      severity: "blocking",
      message: "Brand name is required",
    });
  } else if (brandDisplay.length < 2) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.BRAND_TOO_SHORT,
      field: "brandName",
      severity: "warning",
      message: "Brand name is very short",
    });
  }

  if (!dosageFormDisplay) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.MISSING_DOSAGE_FORM,
      field: "dosageType",
      severity: "blocking",
      message: "Dosage form / type is required",
    });
  }

  if (!strengthDisplay) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.MISSING_STRENGTH,
      field: "strength",
      severity: "blocking",
      message: "Strength is required",
    });
  }

  if (!manufacturerDisplay) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.MISSING_MANUFACTURER,
      field: "manufacturer",
      severity: "blocking",
      message: "Manufacturer is required",
    });
  }

  const hasBlocking = issues.some((i) => i.severity === "blocking");
  if (hasBlocking) {
    const placeholder: NormalizedMedicineRow = {
      genericDisplay: genericDisplay || "",
      genericKey: normalizeKey(f.genericName),
      brandDisplay: brandDisplay || "",
      brandKey: normalizeKey(f.brandName),
      dosageFormDisplay: dosageFormDisplay || "",
      dosageFormKey: normalizeKey(f.dosageType),
      strengthDisplay: strengthDisplay || "",
      strengthKey: normalizeKey(f.strength),
      manufacturerDisplay: manufacturerDisplay || "",
      manufacturerKey: normalizeKey(f.manufacturer),
      packageMarkDisplay,
      packageKey: normalizeKey(f.packageMark || ""),
    };
    return {
      normalized: null,
      issues,
      fingerprint: buildImportFingerprint(countryId, placeholder),
    };
  }

  const hasWarningOnly = issues.some((i) => i.severity === "warning");
  if (hasWarningOnly) {
    issues.push({
      code: MEDICINE_IMPORT_ISSUES.NEEDS_MANUAL_REVIEW,
      severity: "warning",
      message: "Row has validation warnings; review recommended",
    });
  }

  const normalized: NormalizedMedicineRow = {
    genericDisplay,
    genericKey: normalizeKey(genericDisplay),
    brandDisplay,
    brandKey: normalizeKey(brandDisplay),
    dosageFormDisplay,
    dosageFormKey: normalizeKey(dosageFormDisplay),
    strengthDisplay,
    strengthKey: normalizeKey(strengthDisplay),
    manufacturerDisplay,
    manufacturerKey: normalizeKey(manufacturerDisplay),
    packageMarkDisplay,
    packageKey: normalizeKey(packageMarkDisplay || ""),
  };

  return {
    normalized,
    issues,
    fingerprint: buildImportFingerprint(countryId, normalized),
  };
}

export function parseDataRow(raw: Record<string, unknown>, countryId: number): RowParseResult {
  return validateAndBuild(coerceMedicineImportRow(raw), countryId);
}
