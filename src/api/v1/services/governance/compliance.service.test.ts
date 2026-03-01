/**
 * Phase 3: Compliance service — runProductComplianceChecks (status gating, PASS/FAIL/INFO).
 */

const { runProductComplianceChecks } = require("./compliance.service");

describe("runProductComplianceChecks", () => {
  test("returns FAIL when product not found", async () => {
    const prisma = {
      authProduct: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const result = await runProductComplianceChecks(prisma, 1);
    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].status).toBe("FAIL");
    expect(result.checks[0].key).toBe("product_exists");
  });

  test("returns PASS for complete product in SUBMITTED status", async () => {
    const fullProduct = {
      id: 1,
      status: "SUBMITTED",
      brandName: "Brand",
      productName: "Product",
      sku: "SKU1",
      factoryId: 1,
      producerOrgId: 1,
      proofs: [{ id: 1, media: { id: 1 } }, { id: 2, media: { id: 2 } }],
      producerOrg: { id: 1 },
    };
    const mockPrisma = {
      authProduct: {
        findUnique: jest.fn().mockResolvedValue(fullProduct),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const result = await runProductComplianceChecks(mockPrisma, 1);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c: any) => c.status === "PASS" || c.status === "INFO")).toBe(true);
  });

  test("returns INFO for failing checks when product status is not SUBMITTED/UNDER_REVIEW/CHANGES_REQUESTED", async () => {
    const mockPrisma = {
      authProduct: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          status: "ACTIVE",
          brandName: "",
          productName: "Product",
          sku: "SKU1",
          factoryId: null,
          producerOrgId: 1,
          proofs: [],
          producerOrg: { id: 1 },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const result = await runProductComplianceChecks(mockPrisma, 1);
    expect(result.passed).toBe(false);
    const infoChecks = result.checks.filter((c: any) => c.status === "INFO");
    expect(infoChecks.length).toBeGreaterThan(0);
  });
});
