/**
 * Unit tests for insights computation – issue code counts, unmapped aggregation, counts.
 */
import { computeBatchInsights } from "./insightsService";

const mockRows = (
  rows: Array<{ status: string; issues: Array<{ code: string }> | null; normalizedData: Record<string, unknown> | null; matchedProductId: number | null }>
) => rows;

describe("insightsService", () => {
  it("returns null when batch not found", async () => {
    const prisma = {
      productImportBatch: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const result = await computeBatchInsights(prisma as any, 1, 1);
    expect(result).toBeNull();
  });

  it("aggregates issue code counts and status counts", async () => {
    const prisma = {
      productImportBatch: {
        findFirst: jest.fn().mockResolvedValue({
          createdAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
          rows: mockRows([
            { status: "READY", issues: [{ code: "MISSING_DESCRIPTION" }], normalizedData: { brand: "B1" }, matchedProductId: 1 },
            { status: "READY", issues: [], normalizedData: {}, matchedProductId: 2 },
            { status: "NEEDS_FIX", issues: [{ code: "UNMAPPED_BRAND" }, { code: "UNMAPPED_BRAND" }], normalizedData: { brand: "B2" }, matchedProductId: null },
            { status: "ERROR", issues: [{ code: "UNKNOWN" }], normalizedData: {}, matchedProductId: null },
          ]),
        }),
      },
      product: { findFirst: jest.fn().mockResolvedValue({ updatedAt: new Date() }) },
    };
    const result = await computeBatchInsights(prisma as any, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.publishableCount).toBe(2);
    expect(result!.needsFixCount).toBe(1);
    expect(result!.errorCount).toBe(1);
    expect(result!.issueCodeCounts).toEqual(
      expect.arrayContaining([
        { code: "UNMAPPED_BRAND", count: 2 },
        { code: "MISSING_DESCRIPTION", count: 1 },
        { code: "UNKNOWN", count: 1 },
      ])
    );
    expect(result!.topUnmappedValues.BRAND).toEqual([{ externalValue: "b2", count: 1 }]);
  });
});
