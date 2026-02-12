/**
 * Universal Product Import – run full pipeline for a batch (parse → normalize → map → validate → upsert).
 * Processes in chunks and updates progress; idempotent per row (externalProductKey + batchId).
 */
import type { PrismaClient } from "@prisma/client";
import { parseFile } from "./ImportParser";
import { normalizeRow } from "./Normalizer";
import { mapRow, loadMapperCandidates } from "./Mapper";
import { validateRow } from "./Validator";
import { upsertProduct } from "./UpsertEngine";
import { sanitizeRawData } from "./sanitize";
import type { BatchTotals } from "./types";
import type { ValidationIssue } from "../../constants/productImportIssueCodes";
import { IMPORT_CHUNK_SIZE } from "../../constants/productImportLimits";
import { ProductImportRowStatus } from "@prisma/client";

export interface BatchRunnerOptions {
  prisma: PrismaClient;
  orgId: number;
  branchId?: number | null;
  createdByUserId: number;
  provider: string;
  sourceType: "CSV" | "EXCEL" | "API";
  filename?: string | null;
}

export interface RunBatchInput {
  batchId: number;
  buffer: Buffer;
}

export async function runBatchSync(
  options: BatchRunnerOptions,
  input: RunBatchInput
): Promise<{ totals: BatchTotals }> {
  const { prisma, orgId, createdByUserId, provider } = options;
  const { batchId, buffer } = input;

  const sourceType = options.sourceType === "API" ? "CSV" : options.sourceType;
  const records = parseFile(buffer, sourceType);
  const totalRows = records.length;

  const totals: BatchTotals = { total: totalRows, ready: 0, needsFix: 0, error: 0 };
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();

  const candidates = await loadMapperCandidates(prisma);
  const mapperOpts = { orgId, provider, prisma, candidates };

  await prisma.productImportBatch.update({
    where: { id: batchId },
    data: {
      status: "PROCESSING",
      totalRows,
      processedRows: 0,
      progressPercent: 0,
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  const chunkSize = IMPORT_CHUNK_SIZE;
  let processed = 0;

  for (let start = 0; start < records.length; start += chunkSize) {
    const chunk = records.slice(start, start + chunkSize);
    for (let i = 0; i < chunk.length; i++) {
      const idx = start + i;
      const rawUnsanitized = chunk[i] as Record<string, unknown>;
      const raw = sanitizeRawData(rawUnsanitized) as Record<string, string>;
      const externalKey =
        raw.barcode ||
        raw.sku ||
        raw.variant_sku ||
        raw.global_sku ||
        `row-${idx + 1}`;

      const normalized = normalizeRow(raw);
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
          provider,
          batchId,
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
          batchId,
          externalProductKey: String(externalKey),
          rawData: raw as object,
          normalizedData: normalized as object,
          status: finalStatus,
          issues: issuesJson,
          matchedProductId: upsertResult.productId ?? undefined,
        },
      });
    }
    processed += chunk.length;
    const percent = totalRows > 0 ? Math.round((processed / totalRows) * 1000) / 10 : 100;
    await prisma.productImportBatch.update({
      where: { id: batchId },
      data: { processedRows: processed, progressPercent: percent, totals: totals as object },
    });
  }

  await prisma.productImportBatch.update({
    where: { id: batchId },
    data: {
      status: "COMPLETED",
      processedRows: totalRows,
      progressPercent: 100,
      finishedAt: new Date(),
      totals: totals as object,
      errorMessage: null,
    },
  });

  return { totals };
}

/** Run batch with error handling; sets status=FAILED and errorMessage on throw. */
export async function runBatchSyncSafe(
  options: BatchRunnerOptions,
  input: RunBatchInput
): Promise<{ totals: BatchTotals } | { error: string }> {
  const { prisma, orgId } = options;
  const { batchId } = input;
  try {
    return await runBatchSync(options, input);
  } catch (e) {
    const err = e as Error;
    const msg = (err?.message || "Import failed").slice(0, 2000);
    await prisma.productImportBatch.update({
      where: { id: batchId },
      data: { status: "FAILED", errorMessage: msg, finishedAt: new Date() },
    }).catch(() => {});
    return { error: msg };
  }
}
