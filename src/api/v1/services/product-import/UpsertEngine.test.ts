/**
 * Unit tests for UpsertEngine – patch strategy, ambiguous barcode, blocking issues.
 */
import { upsertProduct } from "./UpsertEngine";
import { PRODUCT_IMPORT_ISSUE_CODES } from "../../constants/productImportIssueCodes";

const baseRow = {
  name: "Test Product",
  sku: "SKU-1",
  barcode: "123",
  price: 100,
  categoryId: 1,
  brandId: 1,
};

describe("UpsertEngine", () => {
  it("returns NEEDS_FIX when blocking validation issues present", async () => {
    const prisma = {
      productVariant: { findMany: jest.fn(), findFirst: jest.fn() },
      product: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    };
    const issues = [{ code: PRODUCT_IMPORT_ISSUE_CODES.MISSING_NAME, field: "name", severity: "blocking" as const }];
    const result = await upsertProduct(
      { prisma: prisma as any, orgId: 1, createdByUserId: 1, externalProductKey: "key1" },
      { ...baseRow, name: "" },
      issues
    );
    expect(result.status).toBe("NEEDS_FIX");
    expect(result.productId).toBeNull();
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it("returns AMBIGUOUS_BARCODE when barcode matches multiple products", async () => {
    const prisma = {
      productVariant: {
        findMany: jest.fn().mockResolvedValue([{ productId: 1 }, { productId: 2 }]),
        findFirst: jest.fn(),
      },
      product: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    };
    const result = await upsertProduct(
      { prisma: prisma as any, orgId: 1, createdByUserId: 1, externalProductKey: "key1" },
      baseRow,
      []
    );
    expect(result.status).toBe("NEEDS_FIX");
    expect(result.issues.some((i) => i.code === PRODUCT_IMPORT_ISSUE_CODES.AMBIGUOUS_BARCODE)).toBe(true);
    expect(result.productId).toBeNull();
  });

  it("uses severity blocking to decide NEEDS_FIX (not hardcoded codes)", async () => {
    const prisma = {
      productVariant: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      product: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    };
    const blockingIssue = { code: PRODUCT_IMPORT_ISSUE_CODES.UNMAPPED_BRAND, field: "brand", severity: "blocking" as const, message: "Unmapped" };
    const result = await upsertProduct(
      { prisma: prisma as any, orgId: 1, createdByUserId: 1, externalProductKey: "key1" },
      baseRow,
      [blockingIssue]
    );
    expect(result.status).toBe("NEEDS_FIX");
    expect(result.productId).toBeNull();
  });
});
