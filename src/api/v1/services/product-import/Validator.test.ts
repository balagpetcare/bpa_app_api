/**
 * Unit tests for Validator – issue codes shape, required fields, duplicates.
 */
import { validateRow } from "./Validator";
import { PRODUCT_IMPORT_ISSUE_CODES } from "../../constants/productImportIssueCodes";

describe("Validator", () => {
  const validRow = {
    name: "Product",
    sku: "SKU-1",
    barcode: "123",
    price: 100,
    categoryId: 1,
    brandId: 1,
    description: "Has description",
  };

  it("returns MISSING_NAME when name is empty", () => {
    const issues = validateRow({ ...validRow, name: "" });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.MISSING_NAME)).toBe(true);
    expect(issues[0]).toMatchObject({ field: "name", severity: "blocking" });
  });

  it("returns MISSING_PRICE when price is invalid", () => {
    const issues = validateRow({ ...validRow, price: undefined as any });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.MISSING_PRICE)).toBe(true);
  });

  it("returns MISSING_SKU_OR_BARCODE when both missing", () => {
    const issues = validateRow({ ...validRow, sku: "", barcode: "" });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.MISSING_SKU_OR_BARCODE)).toBe(true);
  });

  it("returns no issues for valid row", () => {
    const issues = validateRow(validRow);
    expect(issues).toHaveLength(0);
  });

  it("returns DUPLICATE_BARCODE when barcode in existingBarcodes", () => {
    const issues = validateRow(validRow, { existingBarcodes: new Set(["123"]), orgId: 1 });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.DUPLICATE_BARCODE)).toBe(true);
    expect(issues[0].meta).toMatchObject({ barcode: "123" });
  });

  it("returns DUPLICATE_SKU when sku in existingSkus", () => {
    const issues = validateRow(validRow, { existingSkus: new Set(["SKU-1"]), orgId: 1 });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.DUPLICATE_SKU)).toBe(true);
  });

  it("returns MISSING_DESCRIPTION (warning) when description empty", () => {
    const issues = validateRow({ ...validRow, description: "" });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.MISSING_DESCRIPTION)).toBe(true);
    expect(issues.find((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.MISSING_DESCRIPTION)!.severity).toBe("warning");
  });

  it("returns ABNORMAL_PRICE (warning) when price is zero", () => {
    const issues = validateRow({ ...validRow, price: 0 });
    expect(issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.ABNORMAL_PRICE)).toBe(true);
  });
});
