export const MEDICINE_IMPORT_ISSUES = {
  MISSING_GENERIC: "MISSING_GENERIC",
  MISSING_BRAND: "MISSING_BRAND",
  MISSING_DOSAGE_FORM: "MISSING_DOSAGE_FORM",
  MISSING_STRENGTH: "MISSING_STRENGTH",
  MISSING_MANUFACTURER: "MISSING_MANUFACTURER",
  GENERIC_TOO_SHORT: "GENERIC_TOO_SHORT",
  BRAND_TOO_SHORT: "BRAND_TOO_SHORT",
  NEEDS_MANUAL_REVIEW: "NEEDS_MANUAL_REVIEW",
} as const;

export type MedicineImportIssueCode = (typeof MEDICINE_IMPORT_ISSUES)[keyof typeof MEDICINE_IMPORT_ISSUES];

export type MedicineImportIssue = {
  code: MedicineImportIssueCode;
  field?: string;
  severity: "blocking" | "warning";
  message?: string;
};

export const ISSUE_SEVERITY: Record<MedicineImportIssueCode, "blocking" | "warning"> = {
  MISSING_GENERIC: "blocking",
  MISSING_BRAND: "blocking",
  MISSING_DOSAGE_FORM: "blocking",
  MISSING_STRENGTH: "blocking",
  MISSING_MANUFACTURER: "blocking",
  GENERIC_TOO_SHORT: "warning",
  BRAND_TOO_SHORT: "warning",
  NEEDS_MANUAL_REVIEW: "warning",
};
