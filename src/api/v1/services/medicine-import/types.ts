import type { MedicineImportIssue } from "../../constants/medicineImportIssueCodes";

/** Canonical normalized fields used for dedupe and upsert. */
export type NormalizedMedicineRow = {
  genericDisplay: string;
  genericKey: string;
  brandDisplay: string;
  brandKey: string;
  dosageFormDisplay: string;
  dosageFormKey: string;
  strengthDisplay: string;
  strengthKey: string;
  manufacturerDisplay: string;
  manufacturerKey: string;
  packageMarkDisplay: string;
  packageKey: string;
};

export type PreviewSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateInFile: number;
  duplicateInDb: number;
  newGenerics: number;
  newDosageForms: number;
  newManufacturers: number;
  newBrands: number;
  newPresentations: number;
  newCountryBrandRows: number;
  updatableExisting: number;
  needsReview: number;
  previewVersion: number;
};

/** Returned from apply engine and persisted on batch.applySummaryJson. */
export type MedicineImportApplySummary = {
  applied: number;
  skipped: number;
  failed: number;
  updatedExisting: number;
  skippedInvalid: number;
  skippedDuplicateInFile: number;
  skippedNeedsReview: number;
  skippedOther: number;
  finalStatus: string;
};

export type RowParseResult = {
  normalized: NormalizedMedicineRow | null;
  issues: MedicineImportIssue[];
  fingerprint: string;
};
