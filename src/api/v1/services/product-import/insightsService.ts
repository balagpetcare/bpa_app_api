/**
 * Import Quality Insights – issue code counts, top unmapped values, time stats.
 */
import type { PrismaClient } from "@prisma/client";

export interface BatchInsights {
  issueCodeCounts: { code: string; count: number }[];
  topUnmappedValues: {
    BRAND: { externalValue: string; count: number }[];
    CATEGORY: { externalValue: string; count: number }[];
    SUBCATEGORY: { externalValue: string; count: number }[];
  };
  publishableCount: number;
  needsFixCount: number;
  errorCount: number;
  timeStats: {
    createdAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    publishAt: Date | null;
  };
}

const TOP_ISSUE_CODES = 20;
const TOP_UNMAPPED_PER_TYPE = 15;

export async function computeBatchInsights(
  prisma: PrismaClient,
  batchId: number,
  orgId: number
): Promise<BatchInsights | null> {
  const batch = await prisma.productImportBatch.findFirst({
    where: { id: batchId, orgId },
    select: {
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      rows: {
        select: { status: true, issues: true, normalizedData: true, matchedProductId: true },
      },
    },
  });
  if (!batch) return null;

  const rows = batch.rows as Array<{ status: string; issues: Array<{ code: string }> | null; normalizedData: Record<string, unknown> | null; matchedProductId: number | null }>;

  const codeCounts = new Map<string, number>();
  let publishableCount = 0;
  let needsFixCount = 0;
  let errorCount = 0;

  const unmappedByType = {
    BRAND: new Map<string, number>(),
    CATEGORY: new Map<string, number>(),
    SUBCATEGORY: new Map<string, number>(),
  };
  const unmappedCodes = {
    BRAND: "UNMAPPED_BRAND",
    CATEGORY: "UNMAPPED_CATEGORY",
    SUBCATEGORY: "UNMAPPED_SUBCATEGORY",
  };
  const unmappedFields = { BRAND: "brand", CATEGORY: "category", SUBCATEGORY: "subcategory" };

  for (const row of rows) {
    if (row.status === "READY") publishableCount++;
    else if (row.status === "NEEDS_FIX") needsFixCount++;
    else errorCount++;

    const issues = (row.issues || []) as Array<{ code: string }>;
    for (const i of issues) {
      if (i.code) codeCounts.set(i.code, (codeCounts.get(i.code) || 0) + 1);
    }

    for (const type of ["BRAND", "CATEGORY", "SUBCATEGORY"] as const) {
      const code = unmappedCodes[type];
      const field = unmappedFields[type];
      if (!issues.some((x) => x.code === code)) continue;
      const val = row.normalizedData?.[field];
      if (val != null && String(val).trim()) {
        const v = String(val).trim().toLowerCase();
        unmappedByType[type].set(v, (unmappedByType[type].get(v) || 0) + 1);
      }
    }
  }

  const issueCodeCounts = Array.from(codeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ISSUE_CODES);

  const topUnmappedValues = {
    BRAND: Array.from(unmappedByType.BRAND.entries())
      .map(([externalValue, count]) => ({ externalValue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_UNMAPPED_PER_TYPE),
    CATEGORY: Array.from(unmappedByType.CATEGORY.entries())
      .map(([externalValue, count]) => ({ externalValue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_UNMAPPED_PER_TYPE),
    SUBCATEGORY: Array.from(unmappedByType.SUBCATEGORY.entries())
      .map(([externalValue, count]) => ({ externalValue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_UNMAPPED_PER_TYPE),
  };

  let publishAt: Date | null = null;
  const productIds = rows.filter((r) => r.matchedProductId != null).map((r) => r.matchedProductId!);
  if (productIds.length > 0) {
    const pub = await prisma.product.findFirst({
      where: { id: { in: productIds }, orgId, publishStatus: "PUBLISHED" },
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    if (pub) publishAt = pub.updatedAt;
  }

  return {
    issueCodeCounts,
    topUnmappedValues,
    publishableCount,
    needsFixCount,
    errorCount,
    timeStats: {
      createdAt: batch.createdAt,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      publishAt,
    },
  };
}
