/**
 * Doctor verification: get/upsert draft, upload documents, submit.
 * Caller must have ClinicStaffProfile with staffType=DOCTOR (same as other doctor routes).
 */
const doctorService = require("./doctor.service");
const doctorVerificationService = require("./doctorVerification.service");
const mediaService = require("../media/media.service");
const { processUploadFile } = require("../media/media.processor");

function asUserId(req: any): number | null {
  const id = req.user?.id ?? req.auth?.userId;
  if (id == null) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function ensureDoctor(req: any, res: any): Promise<number> | null {
  const userId = asUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return doctorService.getDoctorBranchMemberIds(userId).then((ids: number[]) => {
    if (ids.length === 0) {
      res.status(403).json({ success: false, message: "Doctor access required" });
      return null;
    }
    return userId;
  });
}

/** Allow any authenticated user (for verification applicants who don't have ClinicStaffProfile yet). */
function ensureVerificationApplicant(req: any, res: any): number | null {
  const userId = asUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  return userId;
}

async function addSignedDocumentUrls(data: any, userId: number) {
  if (!data?.documents?.length) return data;
  const baseUrl =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  const jwt = require("jsonwebtoken");
  const appConfig = require("../../../../config/appConfig");
  const documents = data.documents.map((d: any) => {
    const key = d.fileUrl || null;
    if (!key) return { ...d, url: null };
    const token = jwt.sign(
      { purpose: "FILE_VIEW", fileKey: key, userId },
      appConfig.jwt.secret,
      { expiresIn: "20m" }
    );
    return {
      ...d,
      url: `${baseUrl}/api/v1/files/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`,
    };
  });
  return { ...data, documents };
}

exports.getVerification = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const data = await doctorVerificationService.getByUserId(userId);
    const out = data ? await addSignedDocumentUrls(data, userId) : null;
    return res.status(200).json({ success: true, data: out });
  } catch (e) {
    console.error("[doctor.getVerification]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get verification" });
  }
};

exports.upsertVerificationDraft = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const body = req.body || {};
    const data = await doctorVerificationService.upsertDraft(userId, {
      licenseNumber: body.licenseNumber,
      registrationBody: body.registrationBody,
      primaryCountryCode: body.primaryCountryCode,
      divisionId: body.divisionId,
      districtId: body.districtId,
      upazilaId: body.upazilaId,
      unionId: body.unionId,
      areaId: body.areaId ?? body.bdAreaId,
      specializationTags: body.specializationTags,
      qualifications: body.qualifications,
      nidNumber: body.nidNumber,
      metadataJson: body.metadataJson,
    });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.upsertVerificationDraft]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to save draft" });
  }
};

exports.uploadVerificationDocument = async (req: any, res: any) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H4',location:'doctorVerification.controller.ts:uploadVerificationDocument:start',message:'upload endpoint entry',data:{hasFile:!!req?.file,bodyType:typeof req?.body?.type==='string'?String(req.body.type).trim().toUpperCase():null,hasDoctorLicenseId:req?.body?.doctorLicenseId!=null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const type = req.body?.type ? String(req.body.type).trim().toUpperCase() : "";
    if (!doctorVerificationService.validateDocumentType(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Allowed: ${[...doctorVerificationService.DOCTOR_DOC_TYPES].join(", ")}`,
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use multipart/form-data field name 'file'.",
      });
    }
    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
    if (file.size && file.size > maxBytes) {
      return res.status(400).json({ success: false, message: `File size exceeds maximum (${maxBytes} bytes).` });
    }
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const mime = (file.mimetype || "").toLowerCase().trim();
    if (!allowedMimes.includes(mime)) {
      return res.status(400).json({
        success: false,
        message: `Invalid file type. Allowed: ${allowedMimes.join(", ")}`,
      });
    }

    const processed = await processUploadFile(file);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H3',location:'doctorVerification.controller.ts:uploadVerificationDocument:processed',message:'file passed validation and processing',data:{mime:String(file?.mimetype||''),size:Number(file?.size||0),processedMime:String(processed?.mimetype||''),processedSize:Number(processed?.size||processed?.buffer?.length||0)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId: userId,
      file: processed,
      folder: "doctor-verification",
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H5',location:'doctorVerification.controller.ts:uploadVerificationDocument:mediaSaved',message:'media upload returned key',data:{hasMedia:!!media,keyPrefix:typeof media?.key==='string'?media.key.split('/').slice(0,2).join('/'):null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const metadataJson =
      req.body?.metadataJson && typeof req.body.metadataJson === "object" ? req.body.metadataJson : null;
    const doctorLicenseId =
      req.body?.doctorLicenseId != null && Number.isFinite(Number(req.body.doctorLicenseId))
        ? Number(req.body.doctorLicenseId)
        : null;

    const doc = await doctorVerificationService.addDocument(userId, type, media.key, metadataJson, doctorLicenseId);
    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9a50c8d-67c2-4353-bdac-e3b81804031b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e348a'},body:JSON.stringify({sessionId:'4e348a',runId:'run1',hypothesisId:'H1',location:'doctorVerification.controller.ts:uploadVerificationDocument:catch',message:'upload endpoint failed',data:{errorName:String((e as any)?.name||''),errorCode:String((e as any)?.code||''),errorMessage:String((e as any)?.message||'')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    console.error("[doctor.uploadVerificationDocument]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to upload document" });
  }
};

exports.deleteVerificationDocument = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const docId = Number(req.params.id);
    if (!Number.isFinite(docId)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }
    const deleted = await doctorVerificationService.deleteDocument(userId, docId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    return res.status(200).json({ success: true, data: { id: deleted.id } });
  } catch (e) {
    console.error("[doctor.deleteVerificationDocument]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to delete document" });
  }
};

exports.submitVerification = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const data = await doctorVerificationService.submit(userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.submitVerification]", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to submit" });
  }
};

exports.addLicense = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const body = req.body || {};
    const regulatoryBodyId = Number(body.regulatoryBodyId);
    if (!Number.isFinite(regulatoryBodyId) || !body.licenseNumber) {
      return res.status(400).json({ success: false, message: "regulatoryBodyId and licenseNumber required" });
    }
    const data = await doctorVerificationService.addLicense(userId, {
      regulatoryBodyId,
      licenseNumber: String(body.licenseNumber).trim(),
      issueDate: body.issueDate ? new Date(body.issueDate) : null,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      isPrimary: !!body.isPrimary,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.addLicense]", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to add license" });
  }
};

exports.updateLicense = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const licenseId = Number(req.params.id);
    if (!Number.isFinite(licenseId)) {
      return res.status(400).json({ success: false, message: "Invalid license id" });
    }
    const body = req.body || {};
    const data = await doctorVerificationService.updateLicense(userId, licenseId, {
      licenseNumber: body.licenseNumber,
      issueDate: body.issueDate != null ? new Date(body.issueDate) : undefined,
      expiryDate: body.expiryDate != null ? new Date(body.expiryDate) : undefined,
      licenseStatus: body.licenseStatus,
      isPrimary: body.isPrimary,
    });
    if (!data) return res.status(404).json({ success: false, message: "License not found" });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("[doctor.updateLicense]", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update license" });
  }
};

exports.deleteLicense = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const licenseId = Number(req.params.id);
    if (!Number.isFinite(licenseId)) {
      return res.status(400).json({ success: false, message: "Invalid license id" });
    }
    const deleted = await doctorVerificationService.deleteLicense(userId, licenseId);
    if (!deleted) return res.status(404).json({ success: false, message: "License not found" });
    return res.status(200).json({ success: true, data: { id: deleted.id } });
  } catch (e) {
    console.error("[doctor.deleteLicense]", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to delete license" });
  }
};

exports.uploadLicenseDocument = async (req: any, res: any) => {
  try {
    const userId = ensureVerificationApplicant(req, res);
    if (userId === null) return;

    const licenseId = Number(req.params.id);
    if (!Number.isFinite(licenseId)) {
      return res.status(400).json({ success: false, message: "Invalid license id" });
    }
    const type = req.body?.type ? String(req.body.type).trim().toUpperCase() : "";
    if (!doctorVerificationService.validateDocumentType(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Allowed: ${[...doctorVerificationService.DOCTOR_DOC_TYPES].join(", ")}`,
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Use multipart/form-data field name 'file'.",
      });
    }
    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
    if (file.size && file.size > maxBytes) {
      return res.status(400).json({ success: false, message: `File size exceeds maximum (${maxBytes} bytes).` });
    }
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const mime = (file.mimetype || "").toLowerCase().trim();
    if (!allowedMimes.includes(mime)) {
      return res.status(400).json({
        success: false,
        message: `Invalid file type. Allowed: ${allowedMimes.join(", ")}`,
      });
    }

    const processed = await processUploadFile(file);
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId: userId,
      file: processed,
      folder: "doctor-verification",
    });
    const metadataJson =
      req.body?.metadataJson && typeof req.body.metadataJson === "object" ? req.body.metadataJson : null;

    const doc = await doctorVerificationService.addDocument(userId, type, media.key, metadataJson, licenseId);
    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    console.error("[doctor.uploadLicenseDocument]", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to upload document" });
  }
};
