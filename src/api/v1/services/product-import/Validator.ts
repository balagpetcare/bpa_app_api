/**
 * Universal Product Import – validate required fields, taxonomy, duplicates, numeric ranges.
 * Returns consistent issues with code, field, severity, message, meta.
 */
import {
  PRODUCT_IMPORT_ISSUE_CODES,
  ISSUE_SEVERITY,
  type ValidationIssue,
  type ProductImportIssueCode,
} from "../../constants/productImportIssueCodes";
import type { ResolvedProductRow } from "./types";

function issue(
  code: ProductImportIssueCode,
  opts: { field?: string; message?: string; meta?: Record<string, unknown> }
): ValidationIssue {
  return {
    code,
    field: opts.field,
    severity: ISSUE_SEVERITY[code],
    message: opts.message,
    meta: opts.meta,
  };
}

export function validateRow(
  row: ResolvedProductRow,
  options?: { existingBarcodes?: Set<string>; existingSkus?: Set<string>; orgId?: number }
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!row.name || String(row.name).trim() === "") {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.MISSING_NAME, { field: "name", message: "Product name is required" }));
  }

  const price = row.price;
  if (price == null || (typeof price === "number" && (Number.isNaN(price) || price < 0))) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.MISSING_PRICE, { field: "price", message: "Valid price is required" }));
  } else if (typeof price === "number" && price > 1e9) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.INVALID_PRICE, { field: "price", message: "Price out of range", meta: { price } }));
  }

  const sku = row.sku ? String(row.sku).trim() : "";
  const barcode = row.barcode ? String(row.barcode).trim() : "";
  if (!sku && !barcode) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.MISSING_SKU_OR_BARCODE, { message: "SKU or barcode is required" }));
  }

  if (row.categoryId != null && row.categoryId <= 0) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.INVALID_CATEGORY_ID, { field: "categoryId", meta: { categoryId: row.categoryId } }));
  }
  if (row.brandId != null && row.brandId <= 0) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.INVALID_BRAND_ID, { field: "brandId", meta: { brandId: row.brandId } }));
  }
  if (row.unitId != null && row.unitId <= 0) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.INVALID_UNIT_ID, { field: "unitId", meta: { unitId: row.unitId } }));
  }

  if (options?.existingBarcodes && barcode && options.existingBarcodes.has(barcode)) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.DUPLICATE_BARCODE, { field: "barcode", message: "Duplicate barcode in file", meta: { barcode } }));
  }
  if (options?.existingSkus && sku && options.existingSkus.has(sku)) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.DUPLICATE_SKU, { field: "sku", message: "Duplicate SKU in file", meta: { sku } }));
  }

  if (!row.description || String(row.description).trim() === "") {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.MISSING_DESCRIPTION, { field: "description", message: "Description is missing" }));
  }

  const imageUrl = (row as Record<string, unknown>).imageUrl ?? (row as Record<string, unknown>).image;
  if (imageUrl !== undefined && (imageUrl == null || String(imageUrl).trim() === "")) {
    issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.MISSING_IMAGE, { field: "image", message: "Image URL is missing" }));
  }

  const priceNum = typeof row.price === "number" ? row.price : Number(row.price);
  if (Number.isFinite(priceNum)) {
    if (priceNum === 0) {
      issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.ABNORMAL_PRICE, { field: "price", message: "Price is zero", meta: { price: priceNum } }));
    } else if (priceNum > 1e8) {
      issues.push(issue(PRODUCT_IMPORT_ISSUE_CODES.ABNORMAL_PRICE, { field: "price", message: "Price unusually high", meta: { price: priceNum } }));
    }
  }

  return issues;
}
