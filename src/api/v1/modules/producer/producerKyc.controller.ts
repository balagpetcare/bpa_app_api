/**
 * Producer KYC controller: VerificationCase (PRODUCER_ORG) + document upload.
 * GET /api/v1/producer/kyc/status, POST /kyc/submit, POST /kyc/documents.
 */

const prisma = require("../../../../infrastructure/db/prismaClient");
const mediaService = require("../media/media.service");
const { processUploadFile } = require("../media/media.processor");
const {
  getProducerKycStatus,
  submitProducerKyc,
  getProducerOrgByUser,
  getOrCreateProducerVerificationCase,
  isAllowedDocType,
  isAllowedMime,
  PRODUCER_KYC_ALLOWED_MIMES,
} = require("./producerKyc.service");

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);

function asIntId(v: any): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/v1/producer/kyc/status */
exports.getKycStatus = async (req: any, res: any) => {
  try {
    const userId = asIntId(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = await getProducerKycStatus(userId);
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({
      success: false,
      message: e?.message || "Failed to get KYC status",
    });
  }
};

/** POST /api/v1/producer/kyc/submit — submit VerificationCase (PRODUCER_ORG) for review */
exports.submitKyc = async (req: any, res: any) => {
  try {
    const userId = asIntId(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { verificationCase } = await submitProducerKyc(userId);
    return res.json({ success: true, data: verificationCase, message: "KYC submitted for review" });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({
      success: false,
      message: e?.message || "Submit failed",
    });
  }
};

/** POST /api/v1/producer/kyc/documents — multipart: file + docType. Creates VerificationDocument + ProducerOrgDocument. */
exports.uploadDocument = async (req: any, res: any) => {
  try {
    const userId = asIntId(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const org = await getProducerOrgByUser(userId);
    if (!org) return res.status(404).json({ success: false, message: "Producer org not found" });

    const vc = await getOrCreateProducerVerificationCase(org.id, { createIfRejected: true });
    if (vc.status === "SUBMITTED") {
      return res.status(400).json({
        success: false,
        message: "Cannot add documents while case is submitted. Wait for review or request changes.",
      });
    }
    if (vc.status === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Case already approved. Request a change to upload new documents.",
      });
    }

    const docTypeRaw = (req.body?.docType || req.body?.type || "").trim().toUpperCase();
    if (!docTypeRaw) return res.status(400).json({ success: false, message: "docType is required" });
    if (!isAllowedDocType(docTypeRaw)) {
      return res.status(400).json({
        success: false,
        message: `Invalid docType. Allowed: NID_FRONT, NID_BACK, SELFIE_WITH_NID, TRADE_LICENSE, INCORPORATION_CERT, OTHER`,
      });
    }

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use multipart/form-data with field name 'file'.",
      });
    }

    if (file.size && file.size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({
        success: false,
        message: `File size exceeds maximum (${MAX_UPLOAD_BYTES} bytes).`,
      });
    }

    const mime = (file.mimetype || "").toLowerCase().trim();
    if (!isAllowedMime(mime)) {
      return res.status(400).json({
        success: false,
        message: `Invalid file type. Allowed: ${PRODUCER_KYC_ALLOWED_MIMES.join(", ")}`,
      });
    }

    // For images, process (resize); for PDF, pass through (buffer only)
    let processed = file;
    if (mime.startsWith("image/")) {
      processed = await processUploadFile(file);
    }
    // else PDF or other allowed: use file as-is

    const ownerUserId = userId; // producer owner
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId,
      file: processed,
      folder: "verification/producer_org",
    });

    const lastSame = await prisma.verificationDocument.findFirst({
      where: { caseId: vc.id, docType: docTypeRaw },
      orderBy: { version: "desc" },
    });

    const verDoc = await prisma.verificationDocument.create({
      data: {
        caseId: vc.id,
        docType: docTypeRaw,
        status: "PENDING",
        isRequired: true,
        mediaId: media.id,
        version: (lastSame?.version || 0) + 1,
      },
      include: { media: true },
    });

    const prodDoc = await prisma.producerOrgDocument.create({
      data: {
        producerOrgId: org.id,
        type: docTypeRaw,
        status: "SUBMITTED",
        mediaId: media.id,
      },
      include: { media: true },
    });

    return res.status(201).json({
      success: true,
      data: {
        verificationDocument: verDoc,
        producerOrgDocument: prodDoc,
      },
    });
  } catch (e: any) {
    return res.status(e?.statusCode || 500).json({
      success: false,
      message: e?.message || "Upload failed",
    });
  }
};

export {};
