/**
 * Run product import from an API provider adapter (cursor pagination → map → validate → upsert).
 * Creates a batch with sourceType=API and feeds normalized rows into the same pipeline as file import.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProviderAdapter } from "./providers/ProviderAdapter";
import { mapRow, loadMapperCandidates } from "./Mapper";
import { validateRow } from "./Validator";
import { upsertProduct } from "./UpsertEngine";
import type { BatchTotals } from "./types";
import type { ValidationIssue } from "../../constants/productImportIssueCodes";
import { IMPORT_CHUNK_SIZE } from "../../constants/productImportLimits";
import { ProductImportRowStatus } from "@prisma/client";

export interface RunApiBatchOptions {
  prisma: PrismaClient;
  orgId: number;
  branchId?: number | null;
  createdByUserId: number;
  adapter: ProviderAdapter;
}

/**
 * Create a batch and run the adapter pipeline (fetchProducts → normalize → map → validate → upsert) in chunks.
 */
export async function runApiBatch(options: RunApiBatchOptions): Promise<{ batchId: number; totals: BatchTotals }> {
  const { prisma, orgId, createdByUserId, adapter } = options;

  const batch = await prisma.productImportBatch.create({
    data: {
      orgId,
      branchId: options.branchId ?? null,
      sourceType: "API",
      provider: adapter.providerName,
      filename: null,
      status: "PROCESSING",
      totalRows: 0,
      processedRows: 0,
      progressPercent: 0,
      startedAt: new Date(),
      createdBy: createdByUserId,
    },
  });

  const candidates = await loadMapperCandidates(prisma);
  const mapperOpts = { orgId, provider: adapter.providerName, prisma, candidates };

  const totals: BatchTotals = { total: 0, ready: 0, needsFix: 0, error: 0 };
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();

  let cursor: string | null = null;
  let totalRows = 0;
  const limit = IMPORT_CHUNK_SIZE;

  try {
    while (true) {
      const { items, nextCursor } = await adapter.fetchProducts({ cursor, limit });
      if (!items.length) break;

      for (let i = 0; i < items.length; i++) {
        const normalized = adapter.normalize(items[i]);
        const externalKey =
          normalized.barcode || normalized.sku || `api-${totalRows + i + 1}`;

        const rawForStorage = normalized as object;
        const { resolved, issues: mapIssues } = await mapRow(mapperOpts, normalized);
        const validationIssues = validateRow(resolved, {
          existingBarcodes: seenBarcodes,
          existingSkus: seenSkus,
          orgId,
        });
        const allIssues: ValidationIssue[] = [...mapIssues, ...validationIssues];

        const upsertResult = await upsertProduct(
          {
            prisma,
            orgId,
            createdByUserId,
            provider: adapter.providerName,
            batchId: batch.id,
            externalProductKey: String(externalKey),
          },
          resolved,
          allIssues
        );

        const finalStatus: ProductImportRowStatus =
          upsertResult.status === "READY"
            ? "READY"
            : upsertResult.status === "NEEDS_FIX"
              ? "NEEDS_FIX"
              : "ERROR";

        if (finalStatus === "READY") {
          totals.ready++;
          if (resolved.barcode) seenBarcodes.add(resolved.barcode);
          if (resolved.sku) seenSkus.add(resolved.sku);
        } else if (finalStatus === "NEEDS_FIX") {
          totals.needsFix++;
        } else {
          totals.error++;
        }

        const issuesJson = (upsertResult.issues.length ? upsertResult.issues : allIssues) as object;

        await prisma.productImportRow.create({
          data: {
            batchId: batch.id,
            externalProductKey: String(externalKey),
            rawData: rawForStorage,
            normalizedData: normalized as object,
            status: finalStatus,
            issues: issuesJson,
            matchedProductId: upsertResult.productId ?? undefined,
          },
        });
      }

      totalRows += items.length;
      totals.total = totalRows;
      const percent = totalRows > 0 ? Math.round((totalRows / (totalRows + (nextCursor ? 1 : 0))) * 1000) / 10 : 0;
      await prisma.productImportBatch.update({
        where: { id: batch.id },
        data: {
          processedRows: totalRows,
          totalRows,
          progressPercent: nextCursor ? percent : 100,
          totals: totals as object,
        },
      });

      if (!nextCursor) break;
      cursor = nextCursor;
    }

    await prisma.productImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMPLETED",
        processedRows: totalRows,
        totalRows,
        progressPercent: 100,
        finishedAt: new Date(),
        totals: totals as object,
        errorMessage: null,
      },
    });

    return { batchId: batch.id, totals };
  } catch (e) {
    const err = e as Error;
    await prisma.productImportBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED", errorMessage: (err?.message || "Import failed").slice(0, 2000), finishedAt: new Date() },
    }).catch(() => {});
    throw e;
  }
}
