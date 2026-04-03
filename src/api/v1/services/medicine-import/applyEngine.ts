import type { Prisma, PrismaClient } from "@prisma/client";
import type { MedicineImportApplySummary, NormalizedMedicineRow } from "./types";
import { medicineImportInteractiveTx, medicineImportShortInteractiveTx } from "./transactionOptions";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Batch simple row status writes (INVALID / duplicate / review / unhandled) for large imports. */
const APPLY_SKIP_ROW_CHUNK = 100;

async function logTouch(
  tx: Tx,
  batchId: number,
  entityType: string,
  entityId: number,
  action: "CREATE" | "UPDATE",
  snapshotJson?: object
) {
  await tx.medicineImportEntityTouch.create({
    data: {
      batchId,
      entityType,
      entityId,
      action,
      snapshotJson: snapshotJson ?? undefined,
    },
  });
}

async function applyNewRow(tx: Tx, batchId: number, countryId: number, rowId: number, n: NormalizedMedicineRow, fingerprint: string) {
  let g = await tx.medicineGeneric.findUnique({ where: { normalizedKey: n.genericKey } });
  if (!g) {
    g = await tx.medicineGeneric.create({
      data: { displayName: n.genericDisplay, normalizedKey: n.genericKey },
    });
    await logTouch(tx, batchId, "GENERIC", g.id, "CREATE", { normalizedKey: n.genericKey });
  }

  let df = await tx.medicineDosageForm.findUnique({ where: { normalizedKey: n.dosageFormKey } });
  if (!df) {
    df = await tx.medicineDosageForm.create({
      data: { displayName: n.dosageFormDisplay, normalizedKey: n.dosageFormKey },
    });
    await logTouch(tx, batchId, "DOSAGE_FORM", df.id, "CREATE", { normalizedKey: n.dosageFormKey });
  }

  let mfr = await tx.medicineManufacturer.findUnique({ where: { normalizedKey: n.manufacturerKey } });
  if (!mfr) {
    mfr = await tx.medicineManufacturer.create({
      data: { displayName: n.manufacturerDisplay, normalizedKey: n.manufacturerKey, isSystem: false },
    });
    await logTouch(tx, batchId, "MANUFACTURER", mfr.id, "CREATE", { normalizedKey: n.manufacturerKey });
  }

  let brand = await tx.medicineBrand.findUnique({
    where: {
      manufacturerId_normalizedKey: { manufacturerId: mfr.id, normalizedKey: n.brandKey },
    },
  });
  if (!brand) {
    brand = await tx.medicineBrand.create({
      data: {
        manufacturerId: mfr.id,
        displayName: n.brandDisplay,
        normalizedKey: n.brandKey,
      },
    });
    await logTouch(tx, batchId, "BRAND", brand.id, "CREATE", {
      manufacturerId: mfr.id,
      normalizedKey: n.brandKey,
    });
  }

  let pres = await tx.medicinePresentation.findUnique({
    where: {
      genericId_dosageFormId_strengthNormalizedKey: {
        genericId: g.id,
        dosageFormId: df.id,
        strengthNormalizedKey: n.strengthKey,
      },
    },
  });
  if (!pres) {
    pres = await tx.medicinePresentation.create({
      data: {
        genericId: g.id,
        dosageFormId: df.id,
        strengthDisplay: n.strengthDisplay,
        strengthNormalizedKey: n.strengthKey,
      },
    });
    await logTouch(tx, batchId, "PRESENTATION", pres.id, "CREATE", {
      genericId: g.id,
      dosageFormId: df.id,
      strengthKey: n.strengthKey,
    });
  }

  const listing = await tx.countryMedicineBrand.upsert({
    where: {
      countryId_importFingerprint: { countryId, importFingerprint: fingerprint },
    },
    create: {
      countryId,
      presentationId: pres.id,
      brandId: brand.id,
      packageMarkDisplay: n.packageMarkDisplay || "",
      packageMarkNormalized: n.packageKey,
      importFingerprint: fingerprint,
      firstImportBatchId: batchId,
      lastImportBatchId: batchId,
      isActive: true,
    },
    update: {
      lastImportBatchId: batchId,
      ...(n.packageMarkDisplay ? { packageMarkDisplay: n.packageMarkDisplay } : {}),
      isActive: true,
    },
  });

  await tx.medicineImportRow.update({
    where: { id: rowId },
    data: {
      applyStatus: "APPLIED",
      countryMedicineBrandId: listing.id,
      applyDetailJson: { outcome: "CREATED_OR_UPSERTED" } as object,
    },
  });
}

type RowSkipPatch = { id: number; data: Prisma.MedicineImportRowUpdateInput };

async function enqueueSkipRowUpdate(prisma: PrismaClient, queue: RowSkipPatch[], patch: RowSkipPatch) {
  queue.push(patch);
  if (queue.length < APPLY_SKIP_ROW_CHUNK) return;
  const batch = queue.splice(0, APPLY_SKIP_ROW_CHUNK);
  await (prisma.$transaction as any)(
    batch.map((u) => prisma.medicineImportRow.update({ where: { id: u.id }, data: u.data })),
    medicineImportInteractiveTx
  );
}

async function flushSkipRowQueue(prisma: PrismaClient, queue: RowSkipPatch[]) {
  while (queue.length > 0) {
    const batch = queue.splice(0, APPLY_SKIP_ROW_CHUNK);
    await (prisma.$transaction as any)(
      batch.map((u) => prisma.medicineImportRow.update({ where: { id: u.id }, data: u.data })),
      medicineImportInteractiveTx
    );
  }
}

/**
 * Apply confirmed batch: NEW rows upsert core + listing; EXISTS_IN_DB refresh metadata; others skipped.
 */
export async function runMedicineImportApply(
  prisma: PrismaClient,
  batchId: number,
  userId: number
): Promise<MedicineImportApplySummary> {
  const batch = await prisma.medicineImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "CONFIRMED") {
    throw new Error(`Batch must be CONFIRMED before apply (current: ${batch.status}).`);
  }

  await prisma.medicineImportBatch.update({
    where: { id: batchId },
    data: { status: "APPLYING", errorMessage: null },
  });

  const summary: MedicineImportApplySummary = {
    applied: 0,
    skipped: 0,
    failed: 0,
    updatedExisting: 0,
    skippedInvalid: 0,
    skippedDuplicateInFile: 0,
    skippedNeedsReview: 0,
    skippedOther: 0,
    finalStatus: "APPLIED",
  };

  const rows = await prisma.medicineImportRow.findMany({
    where: { batchId },
    orderBy: { rowNumber: "asc" },
  });

  const skipRowQueue: RowSkipPatch[] = [];

  for (const row of rows) {
    const cls = row.classification;
    if (cls === "INVALID" || cls === "DUPLICATE_IN_FILE") {
      if (cls === "INVALID") summary.skippedInvalid += 1;
      else summary.skippedDuplicateInFile += 1;
      await enqueueSkipRowUpdate(prisma, skipRowQueue, {
        id: row.id,
        data: {
          applyStatus: "SKIPPED",
          applyDetailJson: { reason: cls } as object,
        },
      });
      summary.skipped += 1;
      continue;
    }

    if (cls === "NEEDS_REVIEW") {
      summary.skippedNeedsReview += 1;
      await enqueueSkipRowUpdate(prisma, skipRowQueue, {
        id: row.id,
        data: {
          applyStatus: "SKIPPED",
          applyDetailJson: { reason: "NEEDS_REVIEW" } as object,
        },
      });
      summary.skipped += 1;
      continue;
    }

    if (cls === "EXISTS_IN_DB") {
      try {
        const n = row.normalizedPayloadJson as NormalizedMedicineRow | null;
        if (!n) {
          throw new Error("Missing normalized payload");
        }
        const fp = row.rowFingerprint;
        const existing = await prisma.countryMedicineBrand.findUnique({
          where: {
            countryId_importFingerprint: { countryId: batch.countryId, importFingerprint: fp },
          },
        });
        if (!existing) {
          await prisma.$transaction(
            async (tx) => {
              await applyNewRow(tx, batchId, batch.countryId, row.id, n, fp);
            },
            medicineImportInteractiveTx
          );
          summary.applied += 1;
          continue;
        }
        const nextPkg = n.packageMarkDisplay || "";
        await (prisma.$transaction as any)(
          [
            prisma.countryMedicineBrand.update({
              where: { id: existing.id },
              data: {
                lastImportBatchId: batchId,
                packageMarkDisplay: existing.packageMarkDisplay || nextPkg,
              },
            }),
            prisma.medicineImportRow.update({
              where: { id: row.id },
              data: {
                applyStatus: "SKIPPED",
                countryMedicineBrandId: existing.id,
                applyDetailJson: { reason: "EXISTS_IN_DB_METADATA_REFRESH" } as object,
              },
            }),
          ],
          medicineImportShortInteractiveTx
        );
        summary.updatedExisting += 1;
      } catch (e) {
        summary.failed += 1;
        const msg = String((e as Error)?.message || e);
        console.error("[MedicineImportApply] EXISTS_IN_DB row failed", { batchId, rowId: row.id, rowNumber: row.rowNumber, msg });
        await prisma.medicineImportRow.update({
          where: { id: row.id },
          data: {
            applyStatus: "FAILED",
            applyDetailJson: { error: msg } as object,
          },
        });
      }
      continue;
    }

    if (cls === "NEW") {
      try {
        const n = row.normalizedPayloadJson as NormalizedMedicineRow | null;
        if (!n) throw new Error("Missing normalized payload");
        await prisma.$transaction(
          async (tx) => {
            await applyNewRow(tx, batchId, batch.countryId, row.id, n, row.rowFingerprint);
          },
          medicineImportInteractiveTx
        );
        summary.applied += 1;
      } catch (e) {
        summary.failed += 1;
        const msg = String((e as Error)?.message || e);
        console.error("[MedicineImportApply] NEW row failed", { batchId, rowId: row.id, rowNumber: row.rowNumber, msg });
        await prisma.medicineImportRow.update({
          where: { id: row.id },
          data: {
            applyStatus: "FAILED",
            applyDetailJson: { error: msg } as object,
          },
        });
      }
      continue;
    }

    summary.skippedOther += 1;
    summary.skipped += 1;
    await enqueueSkipRowUpdate(prisma, skipRowQueue, {
      id: row.id,
      data: {
        applyStatus: "SKIPPED",
        applyDetailJson: { reason: "UNHANDLED_CLASSIFICATION", classification: cls } as object,
      },
    });
  }

  await flushSkipRowQueue(prisma, skipRowQueue);

  const progressed = summary.applied + summary.updatedExisting;
  const finalStatus =
    summary.failed > 0 && progressed > 0
      ? "PARTIALLY_APPLIED"
      : summary.failed > 0 && progressed === 0
        ? "FAILED"
        : "APPLIED";

  summary.finalStatus = finalStatus;

  await prisma.medicineImportBatch.update({
    where: { id: batchId },
    data: {
      status: finalStatus,
      appliedAt: new Date(),
      appliedByUserId: userId,
      applySummaryJson: summary as object,
      errorMessage:
        summary.failed > 0
          ? `Apply finished with ${summary.failed} row failure(s). See row applyDetailJson and server logs.`
          : null,
    },
  });

  return summary;
}
