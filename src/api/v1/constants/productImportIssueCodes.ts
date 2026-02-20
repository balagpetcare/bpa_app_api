/**
 * Universal Product Import – issue codes (stable enum for validation/display).
 * Used in ProductImportRow.issues and Product.validationIssues.
 * Shape: { code, field?, severity, message?, meta? }
 */
export const PRODUCT_IMPORT_ISSUE_CODES = {
  MISSING_NAME: "MISSING_NAME",
  MISSING_PRICE: "MISSING_PRICE",
  MISSING_SKU_OR_BARCODE: "MISSING_SKU_OR_BARCODE",
  UNMAPPED_CATEGORY: "UNMAPPED_CATEGORY",
  UNMAPPED_SUBCATEGORY: "UNMAPPED_SUBCATEGORY",
  UNMAPPED_BRAND: "UNMAPPED_BRAND",
  UNMAPPED_UNIT: "UNMAPPED_UNIT",
  INVALID_CATEGORY_ID: "INVALID_CATEGORY_ID",
  INVALID_BRAND_ID: "INVALID_BRAND_ID",
  INVALID_UNIT_ID: "INVALID_UNIT_ID",
  DUPLICATE_BARCODE: "DUPLICATE_BARCODE",
  DUPLICATE_SKU: "DUPLICATE_SKU",
  AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  AMBIGUOUS_BARCODE: "AMBIGUOUS_BARCODE",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_NUMERIC_RANGE: "INVALID_NUMERIC_RANGE",
  INVALID_SKU_FORMAT: "INVALID_SKU_FORMAT",
  INVALID_BARCODE_FORMAT: "INVALID_BARCODE_FORMAT",
  PARSE_ERROR: "PARSE_ERROR",
  NORMALIZE_ERROR: "NORMALIZE_ERROR",
  UNKNOWN: "UNKNOWN",
  MISSING_DESCRIPTION: "MISSING_DESCRIPTION",
  MISSING_IMAGE: "MISSING_IMAGE",
  ABNORMAL_PRICE: "ABNORMAL_PRICE",
} as const;

export type ProductImportIssueCode = (typeof PRODUCT_IMPORT_ISSUE_CODES)[keyof typeof PRODUCT_IMPORT_ISSUE_CODES];

export type IssueSeverity = "blocking" | "warning" | "info";

export interface ValidationIssue {
  code: ProductImportIssueCode;
  field?: string;
  severity: IssueSeverity;
  message?: string;
  meta?: Record<string, unknown>;
}

/** Default severity per code */
export const ISSUE_SEVERITY: Record<ProductImportIssueCode, IssueSeverity> = {
  MISSING_NAME: "blocking",
  MISSING_PRICE: "blocking",
  MISSING_SKU_OR_BARCODE: "blocking",
  UNMAPPED_CATEGORY: "blocking",
  UNMAPPED_SUBCATEGORY: "blocking",
  UNMAPPED_BRAND: "blocking",
  UNMAPPED_UNIT: "warning",
  INVALID_CATEGORY_ID: "blocking",
  INVALID_BRAND_ID: "blocking",
  INVALID_UNIT_ID: "warning",
  DUPLICATE_BARCODE: "blocking",
  DUPLICATE_SKU: "blocking",
  AMBIGUOUS_MATCH: "blocking",
  AMBIGUOUS_BARCODE: "blocking",
  INVALID_PRICE: "blocking",
  INVALID_NUMERIC_RANGE: "warning",
  INVALID_SKU_FORMAT: "warning",
  INVALID_BARCODE_FORMAT: "warning",
  PARSE_ERROR: "blocking",
  NORMALIZE_ERROR: "blocking",
  UNKNOWN: "blocking",
  MISSING_DESCRIPTION: "warning",
  MISSING_IMAGE: "warning",
  ABNORMAL_PRICE: "warning",
};
