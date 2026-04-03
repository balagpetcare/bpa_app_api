import type { MedicineImportRowClassification } from "@prisma/client";

const prisma = require("../../../../infrastructure/db/prismaClient");
const { writeAudit } = require("../../../../middlewares/auditWriter");
const { ingestMedicineCsvAndPreview } = require("../../services/medicine-import/ingestBatch");
const { runMedicineImportPreview } = require("../../services/medicine-import/previewEngine");
const { runMedicineImportApply } = require("../../services/medicine-import/applyEngine");
const { MEDICINE_IMPORT_MAX_ROWS, MEDICINE_IMPORT_MAX_FILE_BYTES } = require("../../constants/medicineImportLimits");
const { parseCsv } = require("../../services/product-import/ImportParser");
const { sha256Buffer } = require("../../services/medicine-import/fingerprint");

function getUserId(req: any): number | null {
  const id = req.user?.id;
  return id != null ? Number(id) : null;
}

function asInt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

exports.upload = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use multipart field 'file'." });
    }
    if (file.buffer.length > MEDICINE_IMPORT_MAX_FILE_BYTES) {
      return res.status(400).json({
        success: false,
        message: `File too large. Max ${MEDICINE_IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB.`,
      });
    }

    const countryId = asInt(req.body?.countryId);
    const countryCode = req.body?.countryCode ? String(req.body.countryCode).trim().toUpperCase() : "";

    let resolvedCountryId = countryId;
    if (resolvedCountryId == null && countryCode) {
      const c = await prisma.country.findFirst({ where: { code: countryCode }, select: { id: true } });
      if (!c) return res.status(400).json({ success: false, message: `Unknown country code: ${countryCode}` });
      resolvedCountryId = c.id;
    }
    if (resolvedCountryId == null) {
      return res.status(400).json({ success: false, message: "countryId or countryCode is required" });
    }

    const country = await prisma.country.findFirst({
      where: { id: resolvedCountryId },
      select: { id: true, isActive: true, code: true },
    });
    if (!country) {
      return res.status(400).json({ success: false, message: "Country not found for the given id or code." });
    }
    if (!country.isActive) {
      return res.status(400).json({
        success: false,
        message: `Country ${country.code} is inactive. Activate it in admin before importing.`,
      });
    }

    let rowCount = 0;
    try {
      const records = parseCsv(file.buffer);
      rowCount = records.length;
    } catch {
      return res.status(400).json({ success: false, message: "Invalid CSV format or encoding." });
    }
    if (rowCount > MEDICINE_IMPORT_MAX_ROWS) {
      return res.status(400).json({ success: false, message: `Too many rows. Max ${MEDICINE_IMPORT_MAX_ROWS}.` });
    }

    const fileSha256Pre = sha256Buffer(file.buffer);
    const allowDup =
      String(req.body?.allowDuplicateFile || "") === "1" || String(req.body?.allowDuplicateFile).toLowerCase() === "true";
    if (!allowDup) {
      const openDup = await prisma.medicineImportBatch.findFirst({
        where: {
          countryId: resolvedCountryId,
          fileSha256: fileSha256Pre,
          status: { notIn: ["CANCELLED", "FAILED", "APPLIED", "PARTIALLY_APPLIED"] },
        },
        select: { id: true, status: true },
      });
      if (openDup) {
        return res.status(409).json({
          success: false,
          message: `Same file (SHA-256) already has an open import for this country (batch #${openDup.id}, ${openDup.status}). Open that batch or resubmit with allowDuplicateFile=true.`,
          data: { existingBatchId: openDup.id, existingStatus: openDup.status, fileSha256: fileSha256Pre },
        });
      }
    }

    const ingestResult = await ingestMedicineCsvAndPreview(prisma, {
      countryId: resolvedCountryId,
      filename: file.originalname || "upload.csv",
      buffer: file.buffer,
      uploadedByUserId: userId,
      provider: req.body?.provider ? String(req.body.provider) : "admin_csv",
    });

    const { batchId, totalRows, fileSha256, status: ingestStatus } = ingestResult;

    await writeAudit({
      prisma,
      req,
      action: "MEDICINE_IMPORT_UPLOAD",
      entityType: "MEDICINE_IMPORT_BATCH",
      entityId: String(batchId),
      after: {
        countryId: resolvedCountryId,
        countryCode: country.code,
        totalRows,
        filename: file.originalname,
        fileSha256,
        status: ingestStatus,
      },
    });

    return res.status(201).json({
      success: true,
      data: { batchId, totalRows, status: ingestStatus, fileSha256 },
    });
  } catch (e: any) {
    console.error("[MedicineImport] upload failed", {
      message: e?.message,
      countryId: req.body?.countryId,
      filename: req.file?.originalname,
    });
    return res.status(500).json({ success: false, message: e?.message || "Upload failed" });
  }
};

exports.listBatches = async (req: any, res: any) => {
  try {
    const page = Math.max(1, asInt(req.query.page) ?? 1);
    const limit = Math.min(50, Math.max(1, asInt(req.query.limit) ?? 20));
    const skip = (page - 1) * limit;
    const countryId = asInt(req.query.countryId);
    const status = req.query.status ? String(req.query.status) : undefined;

    const where: any = {};
    if (countryId != null) where.countryId = countryId;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.medicineImportBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          country: { select: { id: true, code: true, name: true } },
          uploadedBy: {
            select: {
              id: true,
              auth: { select: { email: true } },
              profile: { select: { displayName: true } },
            },
          },
        },
      }),
      prisma.medicineImportBatch.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (e: any) {
    console.error("listBatches error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.getBatch = async (req: any, res: any) => {
  try {
    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const batch = await prisma.medicineImportBatch.findUnique({
      where: { id },
      include: {
        country: { select: { id: true, code: true, name: true } },
        uploadedBy: {
          select: {
            id: true,
            auth: { select: { email: true } },
            profile: { select: { displayName: true } },
          },
        },
        confirmedBy: {
          select: {
            id: true,
            auth: { select: { email: true } },
            profile: { select: { displayName: true } },
          },
        },
        appliedBy: {
          select: {
            id: true,
            auth: { select: { email: true } },
            profile: { select: { displayName: true } },
          },
        },
      },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const classificationRowCounts = await prisma.medicineImportRow.groupBy({
      by: ["classification"],
      where: { batchId: id },
      _count: { _all: true },
    });
    const rowCountsByClassification = Object.fromEntries(
      classificationRowCounts.map((c) => [c.classification, c._count._all])
    );

    return res.json({ success: true, data: { ...batch, rowCountsByClassification } });
  } catch (e: any) {
    console.error("getBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.preview = async (req: any, res: any) => {
  try {
    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const batch = await prisma.medicineImportBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    if (["CANCELLED", "APPLIED", "PARTIALLY_APPLIED", "CONFIRMED", "APPLYING"].includes(batch.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot re-run preview in status ${batch.status}. After confirmation, use apply or cancel and start a new import.`,
      });
    }

    const summary = await runMedicineImportPreview(prisma, id);
    return res.json({ success: true, data: summary });
  } catch (e: any) {
    console.error("preview error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Preview failed" });
  }
};

exports.confirm = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const expectedVersion = asInt(req.body?.previewVersion);
    const batch = await prisma.medicineImportBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    if (batch.status !== "PREVIEW_READY") {
      return res.status(400).json({
        success: false,
        message: `Batch must be PREVIEW_READY (current: ${batch.status}). Run preview first.`,
      });
    }
    const fresh = batch;
    if (expectedVersion == null) {
      return res.status(400).json({
        success: false,
        code: "PREVIEW_VERSION_REQUIRED",
        message:
          "previewVersion is required. Send the previewVersion from GET batch (previewSummaryJson.previewVersion) so confirmation matches the latest preview.",
      });
    }
    if (expectedVersion !== fresh.previewVersion) {
      return res.status(409).json({
        success: false,
        code: "PREVIEW_VERSION_MISMATCH",
        message: `previewVersion mismatch. Server has ${fresh.previewVersion}; re-run preview and confirm again.`,
      });
    }

    const previewSummary = fresh.previewSummaryJson as { needsReview?: number } | null;
    const needsReviewCount = Number(previewSummary?.needsReview ?? 0);
    if (needsReviewCount > 0 && !req.body?.acknowledgeNeedsReviewSkip) {
      return res.status(400).json({
        success: false,
        code: "NEEDS_REVIEW_ROWS",
        needsReview: needsReviewCount,
        message: `${needsReviewCount} row(s) are flagged NEEDS_REVIEW and will be skipped on apply. Fix the file and re-preview, or resend confirm with acknowledgeNeedsReviewSkip: true if you accept skipping them.`,
      });
    }

    await prisma.medicineImportBatch.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedByUserId: userId,
      },
    });

    await writeAudit({
      prisma,
      req,
      action: "MEDICINE_IMPORT_CONFIRM",
      entityType: "MEDICINE_IMPORT_BATCH",
      entityId: String(id),
      after: {
        previewVersion: fresh.previewVersion,
        needsReviewAcknowledged: Boolean(req.body?.acknowledgeNeedsReviewSkip),
      },
    });

    return res.json({ success: true, data: { batchId: id, status: "CONFIRMED" } });
  } catch (e: any) {
    console.error("confirm error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Confirm failed" });
  }
};

exports.apply = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const summary = await runMedicineImportApply(prisma, id, userId);

    await writeAudit({
      prisma,
      req,
      action: "MEDICINE_IMPORT_APPLY",
      entityType: "MEDICINE_IMPORT_BATCH",
      entityId: String(id),
      after: summary,
    });

    return res.json({ success: true, data: summary });
  } catch (e: any) {
    console.error("apply error:", e);
    return res.status(400).json({ success: false, message: e?.message || "Apply failed" });
  }
};

exports.cancel = async (req: any, res: any) => {
  try {
    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const batch = await prisma.medicineImportBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    if (["APPLIED", "PARTIALLY_APPLIED", "APPLYING"].includes(batch.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel batch in status ${batch.status}` });
    }

    await prisma.medicineImportBatch.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await writeAudit({
      prisma,
      req,
      action: "MEDICINE_IMPORT_CANCEL",
      entityType: "MEDICINE_IMPORT_BATCH",
      entityId: String(id),
      before: { status: batch.status, filename: batch.filename, fileSha256: batch.fileSha256 },
      after: { status: "CANCELLED" },
    });

    return res.json({ success: true, data: { batchId: id, status: "CANCELLED" } });
  } catch (e: any) {
    console.error("cancel error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Cancel failed" });
  }
};

const PURGE_ELIGIBLE = new Set(["CANCELLED", "FAILED", "UPLOADED", "PARSED", "PREVIEW_READY"]);

exports.purgeBatch = async (req: any, res: any) => {
  try {
    const id = asInt(req.params.id);
    if (id == null) return res.status(400).json({ success: false, message: "Invalid id" });

    const batch = await prisma.medicineImportBatch.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        filename: true,
        fileSha256: true,
        countryId: true,
        totalRows: true,
      },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });
    if (!PURGE_ELIGIBLE.has(batch.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot purge batch in status ${batch.status}. Only cancelled, failed, or pre-confirm staging batches may be purged.`,
      });
    }

    await writeAudit({
      prisma,
      req,
      action: "MEDICINE_IMPORT_BATCH_PURGE",
      entityType: "MEDICINE_IMPORT_BATCH",
      entityId: String(id),
      before: {
        status: batch.status,
        filename: batch.filename,
        fileSha256: batch.fileSha256,
        countryId: batch.countryId,
        totalRows: batch.totalRows,
      },
      after: { purged: true },
    });

    await prisma.medicineImportBatch.delete({ where: { id } });

    return res.json({ success: true, data: { batchId: id, purged: true } });
  } catch (e: any) {
    console.error("purgeBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Purge failed" });
  }
};

exports.listRows = async (req: any, res: any) => {
  try {
    const batchId = asInt(req.params.id);
    if (batchId == null) return res.status(400).json({ success: false, message: "Invalid batch id" });

    const page = Math.max(1, asInt(req.query.page) ?? 1);
    const limit = Math.min(200, Math.max(1, asInt(req.query.limit) ?? 50));
    const skip = (page - 1) * limit;
    const classification = req.query.classification ? String(req.query.classification) : undefined;
    const applyStatus = req.query.applyStatus ? String(req.query.applyStatus) : undefined;

    const allowedClass = new Set([
      "INVALID",
      "DUPLICATE_IN_FILE",
      "EXISTS_IN_DB",
      "NEW",
      "NEEDS_REVIEW",
    ]);
    if (classification && !allowedClass.has(classification)) {
      return res.status(400).json({ success: false, message: "Invalid classification filter." });
    }
    const allowedApply = new Set(["PENDING", "APPLIED", "SKIPPED", "FAILED"]);
    if (applyStatus && !allowedApply.has(applyStatus)) {
      return res.status(400).json({ success: false, message: "Invalid applyStatus filter." });
    }

    const where: any = { batchId };
    if (classification) where.classification = classification;
    if (applyStatus) where.applyStatus = applyStatus;

    const [items, total] = await Promise.all([
      prisma.medicineImportRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { rowNumber: "asc" },
      }),
      prisma.medicineImportRow.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (e: any) {
    console.error("listRows error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.exportClassification = async (req: any, res: any) => {
  try {
    const batchId = asInt(req.params.id);
    if (batchId == null) return res.status(400).json({ success: false, message: "Invalid batch id" });

    const classification = String(req.query.classification || "").trim();
    const allowed = new Set(["INVALID", "NEEDS_REVIEW", "DUPLICATE_IN_FILE", "EXISTS_IN_DB", "NEW"]);
    if (!allowed.has(classification)) {
      return res.status(400).json({
        success: false,
        message: "Query classification must be one of: INVALID, NEEDS_REVIEW, DUPLICATE_IN_FILE, EXISTS_IN_DB, NEW.",
      });
    }

    const rows = await prisma.medicineImportRow.findMany({
      where: { batchId, classification: classification as MedicineImportRowClassification },
      orderBy: { rowNumber: "asc" },
    });

    const headers = ["rowNumber", "classification", "issuesJson", "rawPayloadJson"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const raw = JSON.stringify(r.rawPayloadJson ?? {});
      const iss = JSON.stringify(r.issuesJson ?? []);
      lines.push(
        [r.rowNumber, r.classification, iss, raw].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      );
    }
    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="medicine-import-${batchId}-${classification.toLowerCase()}.csv"`
    );
    return res.send(csv);
  } catch (e: any) {
    console.error("exportClassification error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Export failed" });
  }
};

exports.exportInvalid = async (req: any, res: any) => {
  try {
    const batchId = asInt(req.params.id);
    if (batchId == null) return res.status(400).json({ success: false, message: "Invalid batch id" });

    const rows = await prisma.medicineImportRow.findMany({
      where: { batchId, classification: "INVALID" },
      orderBy: { rowNumber: "asc" },
    });

    const headers = ["rowNumber", "issuesJson", "rawPayloadJson"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const raw = JSON.stringify(r.rawPayloadJson ?? {});
      const iss = JSON.stringify(r.issuesJson ?? []);
      lines.push([r.rowNumber, iss, raw].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    }
    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="medicine-import-${batchId}-invalid.csv"`);
    return res.send(csv);
  } catch (e: any) {
    console.error("exportInvalid error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Export failed" });
  }
};

export {};
