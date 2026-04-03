import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "../product-import/ImportParser";
import { MEDICINE_IMPORT_CHUNK_SIZE } from "../../constants/medicineImportLimits";
import { sha256Buffer } from "./fingerprint";
import { runMedicineImportPreview } from "./previewEngine";

/**
 * Parse CSV buffer into staging rows and run first preview.
 */
export async function ingestMedicineCsvAndPreview(
  prisma: PrismaClient,
  params: {
    countryId: number;
    filename: string;
    buffer: Buffer;
    uploadedByUserId: number;
    provider?: string;
  }
): Promise<{ batchId: number; totalRows: number; fileSha256: string; status: string }> {
  const { countryId, filename, buffer, uploadedByUserId, provider = "admin_csv" } = params;

  let records: Record<string, string>[];
  try {
    records = parseCsv(buffer);
  } catch {
    throw new Error("Invalid CSV format or encoding.");
  }

  const fileSha256 = sha256Buffer(buffer);
  const fileSizeBytes = buffer.length;

  const batch = await prisma.medicineImportBatch.create({
    data: {
      countryId,
      filename: filename.slice(0, 512),
      fileSha256,
      fileSizeBytes,
      provider,
      status: "UPLOADED",
      totalRows: records.length,
      uploadedByUserId,
    },
  });

  for (let i = 0; i < records.length; i += MEDICINE_IMPORT_CHUNK_SIZE) {
    const slice = records.slice(i, i + MEDICINE_IMPORT_CHUNK_SIZE);
    await prisma.medicineImportRow.createMany({
      data: slice.map((raw, j) => ({
        batchId: batch.id,
        rowNumber: i + j + 1,
        rawPayloadJson: raw as object,
        rowFingerprint: "0".repeat(64),
        classification: "INVALID",
      })),
    });
  }

  await prisma.medicineImportBatch.update({
    where: { id: batch.id },
    data: { status: "PARSED" },
  });

  try {
    await runMedicineImportPreview(prisma, batch.id);
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 10000);
    await prisma.medicineImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        errorMessage: `Preview failed after staging rows: ${msg}`,
      },
    });
    throw e;
  }

  const final = await prisma.medicineImportBatch.findUnique({
    where: { id: batch.id },
    select: { status: true },
  });

  return {
    batchId: batch.id,
    totalRows: records.length,
    fileSha256,
    status: final?.status ?? "PREVIEW_READY",
  };
}
