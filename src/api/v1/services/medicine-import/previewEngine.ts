import { Prisma, type PrismaClient } from "@prisma/client";
import type { MedicineImportRowClassification } from "@prisma/client";
import { parseDataRow } from "./rowModel";
import type { PreviewSummary } from "./types";
import { medicineImportInteractiveTx } from "./transactionOptions";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Max `medicineImportRow.update` calls per interactive `$transaction`.
 * Keep each chunk small enough to finish comfortably under load even if defaults
 * were misconfigured; `medicineImportInteractiveTx` still sets an explicit cap.
 */
export const MEDICINE_PREVIEW_ROW_UPDATE_CHUNK = 40;

type RowPreviewUpdate = {
  id: number;
  data: {
    normalizedPayloadJson: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    issuesJson: Prisma.InputJsonValue;
    rowFingerprint: string;
    classification: MedicineImportRowClassification;
    duplicateOfRowNumber: number | null;
  };
};

/** Sequential batch transaction ops (root client) — avoids interactive `tx` lifecycle issues. */
function previewRowUpdateOp(prisma: PrismaClient, u: RowPreviewUpdate) {
  return prisma.medicineImportRow.update({
    where: { id: u.id },
    data: {
      normalizedPayloadJson: u.data.normalizedPayloadJson,
      issuesJson: u.data.issuesJson,
      rowFingerprint: u.data.rowFingerprint,
      classification: u.data.classification,
      duplicateOfRowNumber: u.data.duplicateOfRowNumber,
      applyStatus: "PENDING",
      applyDetailJson: null,
      countryMedicineBrandId: null,
    },
  });
}

async function loadReferenceKeySets(tx: Tx, countryId: number) {
  // Sequential reads only: interactive transaction clients must not run parallel queries (Promise.all).
  const generics = await tx.medicineGeneric.findMany({ select: { normalizedKey: true } });
  const forms = await tx.medicineDosageForm.findMany({ select: { normalizedKey: true } });
  const mfrs = await tx.medicineManufacturer.findMany({ select: { normalizedKey: true } });
  const brands = await tx.medicineBrand.findMany({
    select: { normalizedKey: true, manufacturerId: true, manufacturer: { select: { normalizedKey: true } } },
  });
  const pres = await tx.medicinePresentation.findMany({
    select: {
      strengthNormalizedKey: true,
      generic: { select: { normalizedKey: true } },
      dosageForm: { select: { normalizedKey: true } },
    },
  });
  const existingFp = await tx.countryMedicineBrand.findMany({
    where: { countryId },
    select: { importFingerprint: true },
  });

  const genericSet = new Set(generics.map((g) => g.normalizedKey));
  const formSet = new Set(forms.map((f) => f.normalizedKey));
  const mfrSet = new Set(mfrs.map((m) => m.normalizedKey));
  const brandPairSet = new Set(
    brands.map((b) => `${b.manufacturer.normalizedKey}|${b.normalizedKey}`)
  );
  const presentationSet = new Set(
    pres.map((p) => `${p.generic.normalizedKey}|${p.dosageForm.normalizedKey}|${p.strengthNormalizedKey}`)
  );
  const fingerprintSet = new Set(existingFp.map((e) => e.importFingerprint));

  return { genericSet, formSet, mfrSet, brandPairSet, presentationSet, fingerprintSet };
}

function countNetNewForRow(
  n: import("./types").NormalizedMedicineRow,
  refs: Awaited<ReturnType<typeof loadReferenceKeySets>>,
  tallies: {
    newGeneric: Set<string>;
    newForm: Set<string>;
    newMfr: Set<string>;
    newBrandPair: Set<string>;
    newPresentation: Set<string>;
  }
) {
  if (!refs.genericSet.has(n.genericKey)) tallies.newGeneric.add(n.genericKey);
  if (!refs.formSet.has(n.dosageFormKey)) tallies.newForm.add(n.dosageFormKey);
  if (!refs.mfrSet.has(n.manufacturerKey)) tallies.newMfr.add(n.manufacturerKey);
  const bp = `${n.manufacturerKey}|${n.brandKey}`;
  if (!refs.brandPairSet.has(bp)) tallies.newBrandPair.add(bp);
  const pk = `${n.genericKey}|${n.dosageFormKey}|${n.strengthKey}`;
  if (!refs.presentationSet.has(pk)) tallies.newPresentation.add(pk);
}

/**
 * Recompute preview for all rows in batch; bump previewVersion; store summary on batch.
 */
export async function runMedicineImportPreview(prisma: PrismaClient, batchId: number): Promise<PreviewSummary> {
  const batch = await prisma.medicineImportBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) throw new Error("Batch not found");
  const noPreviewStatuses = new Set([
    "CANCELLED",
    "APPLIED",
    "PARTIALLY_APPLIED",
    "CONFIRMED",
    "APPLYING",
  ]);
  if (noPreviewStatuses.has(batch.status)) {
    throw new Error(
      `Cannot re-run preview in status ${batch.status}. Cancelled and post-confirm batches are frozen; use a new upload if needed.`
    );
  }

  const refs = await loadReferenceKeySets(prisma, batch.countryId);
  const nextVersion = batch.previewVersion + 1;

  const firstSeenFingerprint = new Map<string, number>();
  const tallies = {
    newGeneric: new Set<string>(),
    newForm: new Set<string>(),
    newMfr: new Set<string>(),
    newBrandPair: new Set<string>(),
    newPresentation: new Set<string>(),
  };

  let invalidRows = 0;
  let duplicateInFile = 0;
  let duplicateInDb = 0;
  let newCountryBrandRows = 0;
  let needsReview = 0;

  const updates: RowPreviewUpdate[] = [];

  for (const row of batch.rows) {
    const raw = row.rawPayloadJson as Record<string, unknown>;
    const parsed = parseDataRow(raw, batch.countryId);
    const blocking = parsed.issues.filter((i) => i.severity === "blocking");

    if (blocking.length > 0 || !parsed.normalized) {
      invalidRows += 1;
      updates.push({
        id: row.id,
        data: {
          normalizedPayloadJson: parsed.normalized ? (parsed.normalized as Prisma.InputJsonValue) : Prisma.JsonNull,
          issuesJson: parsed.issues as Prisma.InputJsonValue,
          rowFingerprint: parsed.fingerprint,
          classification: "INVALID",
          duplicateOfRowNumber: null,
        },
      });
      continue;
    }

    const n = parsed.normalized;
    const fp = parsed.fingerprint;
    const firstRow = firstSeenFingerprint.get(fp);
    if (firstRow !== undefined && firstRow !== row.rowNumber) {
      duplicateInFile += 1;
      updates.push({
        id: row.id,
        data: {
          normalizedPayloadJson: n as Prisma.InputJsonValue,
          issuesJson: parsed.issues as Prisma.InputJsonValue,
          rowFingerprint: fp,
          classification: "DUPLICATE_IN_FILE",
          duplicateOfRowNumber: firstRow,
        },
      });
      continue;
    }
    firstSeenFingerprint.set(fp, row.rowNumber);

    if (refs.fingerprintSet.has(fp)) {
      duplicateInDb += 1;
      updates.push({
        id: row.id,
        data: {
          normalizedPayloadJson: n as Prisma.InputJsonValue,
          issuesJson: parsed.issues as Prisma.InputJsonValue,
          rowFingerprint: fp,
          classification: "EXISTS_IN_DB",
          duplicateOfRowNumber: null,
        },
      });
      continue;
    }

    const warn = parsed.issues.some((i) => i.severity === "warning");
    if (warn) {
      needsReview += 1;
      updates.push({
        id: row.id,
        data: {
          normalizedPayloadJson: n as Prisma.InputJsonValue,
          issuesJson: parsed.issues as Prisma.InputJsonValue,
          rowFingerprint: fp,
          classification: "NEEDS_REVIEW",
          duplicateOfRowNumber: null,
        },
      });
      continue;
    }

    countNetNewForRow(n, refs, tallies);
    newCountryBrandRows += 1;
    updates.push({
      id: row.id,
      data: {
        normalizedPayloadJson: n as Prisma.InputJsonValue,
        issuesJson: parsed.issues as Prisma.InputJsonValue,
        rowFingerprint: fp,
        classification: "NEW",
        duplicateOfRowNumber: null,
      },
    });
  }

  const totalRows = batch.rows.length;
  const validRows = totalRows - invalidRows;

  const summary: PreviewSummary = {
    totalRows,
    validRows,
    invalidRows,
    duplicateInFile,
    duplicateInDb,
    newGenerics: tallies.newGeneric.size,
    newDosageForms: tallies.newForm.size,
    newManufacturers: tallies.newMfr.size,
    newBrands: tallies.newBrandPair.size,
    newPresentations: tallies.newPresentation.size,
    newCountryBrandRows,
    updatableExisting: duplicateInDb,
    needsReview,
    previewVersion: nextVersion,
  };

  // Row writes: chunked sequential batch transactions (array form), not interactive `tx` callbacks.
  // Batch header: single statement after all row chunks (no nested interactive client).
  for (let i = 0; i < updates.length; i += MEDICINE_PREVIEW_ROW_UPDATE_CHUNK) {
    const slice = updates.slice(i, i + MEDICINE_PREVIEW_ROW_UPDATE_CHUNK);
    await (prisma.$transaction as any)(
      slice.map((u) => previewRowUpdateOp(prisma, u)),
      medicineImportInteractiveTx
    );
  }

  await prisma.medicineImportBatch.update({
    where: { id: batchId },
    data: {
      previewVersion: nextVersion,
      previewSummaryJson: summary as object,
      status: "PREVIEW_READY",
      errorMessage: null,
    },
  });

  return summary;
}
