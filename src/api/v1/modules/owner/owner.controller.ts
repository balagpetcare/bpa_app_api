const { writeAudit } = require('../../../../middlewares/auditWriter');
const mediaService = require('../media/media.service');
const { processUploadFile } = require('../media/media.processor');
const {
  getBranchAccessListForOwner,
  approveBranchAccess,
  revokeBranchAccess,
  assignBranchAccessDirect,
  suspendBranchAccess,
  removeBranchAccess,
  updateBranchAccessRole,
  getOwnerStaffAccessRows,
  getOwnerStaffAccessRowsByUser,
  getOwnerBranchAccessRequest,
} = require('../../services/branchAccessPermission.service');
const {
  notifyStaffOfApproval,
  notifyStaffOfRevocation,
} = require('../../services/branchAccessNotification.service');
const {
  getEffectiveOrgIdsForOwnerPanel,
  getEffectiveBranchIdsForOwnerPanel,
} = require('../../services/ownerPanelAccess.service');

const REQUIRED_OWNER_KYC_DOCS = ['NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID'];
const KYC_EXPIRY_DAYS = Number(process.env.KYC_EXPIRY_DAYS || 45);

function normalizeDocType(t) {
  if (!t) return null;
  const v = String(t).trim().toUpperCase();
  return v;
}

function parseDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function pickDelegate(prisma, names) {
  for (const n of names) {
    if (prisma && prisma[n]) return prisma[n];
  }
  return null;
}

async function markOrgLegalAsDraftIfNeeded(prisma, orgId) {
  const lp = await prisma.organizationLegalProfile.findFirst({ where: { orgId } });
  if (!lp) return null;

  // Allow editing until approved. If the profile is already VERIFIED, keep it locked.
  if (lp.verificationStatus === 'VERIFIED') return lp;

  // If it was submitted/rejected, editing means the owner is preparing a revised version.
  if (lp.verificationStatus === 'SUBMITTED' || lp.verificationStatus === 'REJECTED') {
    return await prisma.organizationLegalProfile.update({
      where: { id: lp.id },
      data: {
        verificationStatus: 'UNSUBMITTED',
        submittedAt: null,
        reviewedAt: null,
        reviewNote: null,
        rejectionReason: null,
      },
    });
  }
  return lp;
}

async function upsertOrgLegalProfile(prisma, orgId, patch) {
  // Ensure required field `organizationName` is always present.
  // Source of truth: Organization.name (fallback to provided patch).
  const orgRow = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const orgName =
    (patch?.organizationName ? String(patch.organizationName).trim() : '') ||
    (orgRow?.name ? String(orgRow.name).trim() : '');
  if (!orgName) {
    throw new Error('organizationName is required');
  }

  // Sanitize legacy fields that are not part of the current Prisma schema.
  // We previously used JSON fallbacks like documentsJson/directorsJson in older iterations.
  const cleanPatch = patch && typeof patch === 'object' ? { ...patch } : {};
  if (cleanPatch.documentsJson !== undefined) delete cleanPatch.documentsJson;
  if (cleanPatch.directorsJson !== undefined) delete cleanPatch.directorsJson;

  // Map legacy status names to current enum values.
  // Prisma enum: UNSUBMITTED | SUBMITTED | VERIFIED | REJECTED
  if (cleanPatch.verificationStatus === 'PENDING_REVIEW') cleanPatch.verificationStatus = 'SUBMITTED';

  // Prefer a 1:1 profile by orgId. If orgId is not unique in the schema,
  // fallback to findFirst + create/update by id.
  try {
    return await prisma.organizationLegalProfile.upsert({
      where: { orgId },
      create: {
        orgId,
        organizationName: orgName,
        verificationStatus: 'UNSUBMITTED',
        ...cleanPatch
      },
      update: {
        organizationName: orgName,
        ...cleanPatch
      }
    });
  } catch (e) {
    // Fallback: orgId may not be unique.
    const existing = await prisma.organizationLegalProfile.findFirst({ where: { orgId } });
    if (existing) {
      return await prisma.organizationLegalProfile.update({
        where: { id: existing.id },
        data: { organizationName: orgName, ...cleanPatch },
      });
    }
    return await prisma.organizationLegalProfile.create({
      data: {
        orgId,
        organizationName: orgName,
        verificationStatus: 'UNSUBMITTED',
        ...cleanPatch
      }
    });
  }
}

function asIntId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return n;
}

function assertOrgEditable(status) {
  // Organizations: draft/edit allowed only when not yet approved.
  // Allow edits while under review; if edited, we will move it back to NOT_APPLIED.
  return status === 'NOT_APPLIED' || status === 'REJECTED';
}

function assertBranchEditable(status) {
  // Branches: allow edits when still draft or returned.
  return status === 'DRAFT' || status === 'INACTIVE' || status === 'BLOCKED';
}

function isVerificationHardLockEnabled() {
  return String(process.env.VERIFICATION_HARD_LOCK || '').toLowerCase() === 'true';
}

async function saveVerificationDraftFromLegacy(prisma, { entityType, entityId, payloadJson }) {
  // Keep this helper local to avoid touching shared code paths.
  // If there's a SUBMITTED case, create a new DRAFT revision so the owner can keep editing.
  const latest = await prisma.verificationCase.findFirst({
    where: { entityType, entityId, status: { in: ['DRAFT', 'REJECTED', 'SUBMITTED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });

  if (!latest || latest.status === 'SUBMITTED') {
    return await prisma.verificationCase.create({
      data: { entityType, entityId, status: 'DRAFT', payloadJson },
      select: { id: true, status: true },
    });
  }

  return await prisma.verificationCase.update({
    where: { id: latest.id },
    data: { payloadJson },
    select: { id: true, status: true },
  });
}

function buildVerificationSignal(
  { locked, status, message, action, caseId, caseStatus }: { locked?: boolean; status?: any; message?: any; action?: any; caseId?: any; caseStatus?: any } = {}
) {
  return {
    locked: !!locked,
    status: status || null,
    message: message || null,
    action: action || null,
    case: caseId ? { id: caseId, status: caseStatus || null } : null,
  };
}


function isHardLockEnabled() {
  const v = String(process.env.VERIFICATION_HARD_LOCK || 'false').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function upsertVerificationDraftFromLockedUpdate({ prisma, entityType, entityId, payloadJson }) {
  // Find latest non-approved case; if none, create a new DRAFT case.
  const existing = await prisma.verificationCase.findFirst({
    where: {
      entityType,
      entityId,
      status: { in: ['DRAFT', 'REJECTED', 'SUBMITTED'] },
    },
    orderBy: { updatedAt: 'desc' },
    include: { documents: true, events: true },
  });

  if (existing && existing.status !== 'SUBMITTED') {
    return prisma.verificationCase.update({
      where: { id: existing.id },
      data: { payloadJson },
      include: { documents: true, events: true },
    });
  }

  // If SUBMITTED (under review) or none exists, create a fresh DRAFT revision case.
  return prisma.verificationCase.create({
    data: {
      entityType,
      entityId,
      status: 'DRAFT',
      payloadJson,
      events: {
        create: {
          action: 'LOCKED_UPDATE_DRAFT_SAVED',
          message: 'A locked update was saved as a draft for re-verification.',
        },
      },
    },
    include: { documents: true, events: true },
  });
}

async function ensureOwnerOrg(prisma, ownerUserId, orgId) {
  const org = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId } });
  return org;
}

async function ensureOwnerBranch(prisma, ownerUserId, branchId) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      org: { ownerUserId },
    },
  });
  return branch;
}

async function upsertBranchProfileDetails(prisma, branchId, data) {
  // BranchProfileDetails has a unique branchId
  const existing = await prisma.branchProfileDetails.findUnique({ where: { branchId } }).catch(() => null);
  if (existing) {
    return prisma.branchProfileDetails.update({ where: { id: existing.id }, data });
  }
  return prisma.branchProfileDetails.create({ data: { branchId, ...data } });
}

async function validateBdLocationRefs(prisma, { divisionId, districtId, upazilaId, areaId }) {
  // All args optional; if provided must exist.
  if (divisionId) {
    const ok = await prisma.bdDivision.findUnique({ where: { id: divisionId } });
    if (!ok) return { ok: false, message: 'Invalid divisionId' };
  }
  if (districtId) {
    const ok = await prisma.bdDistrict.findUnique({ where: { id: districtId } });
    if (!ok) return { ok: false, message: 'Invalid districtId' };
  }
  if (upazilaId) {
    const ok = await prisma.bdUpazila.findUnique({ where: { id: upazilaId } });
    if (!ok) return { ok: false, message: 'Invalid upazilaId' };
  }
  if (areaId) {
    const ok = await prisma.bdArea.findUnique({ where: { id: areaId } });
    if (!ok) return { ok: false, message: 'Invalid areaId' };
  }
  return { ok: true };
}

// ----------------------------
// v1.1: Owner profile + KYC
// ----------------------------

exports.getOwnerMe = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: {
        id: true,
        status: true,
        role: true,
        createdAt: true,
        ownerProfile: true,
        ownerKyc: { select: { id: true, verificationStatus: true, submittedAt: true, reviewedAt: true, rejectionReason: true, reviewNote: true } },
      }
    });

    res.json({ success: true, data: user });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getOwnerProfile = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const profile = await prisma.ownerProfile.findUnique({ where: { userId: ownerUserId } });
    res.json({ success: true, data: profile });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.upsertOwnerProfile = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const name = req.body?.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    // Unified address (country/state/city/postal/addressLine/lat/lng) - no DB hierarchy
    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : null;

    const divisionId = asIntId(req.body?.divisionId);
    const districtId = asIntId(req.body?.districtId);
    const upazilaId = asIntId(req.body?.upazilaId);
    const areaId = asIntId(req.body?.areaId);

    // Only validate BD refs when legacy division/district/upazila/area are provided
    if (divisionId || districtId || upazilaId || areaId) {
      const vr = await validateBdLocationRefs(prisma, { divisionId, districtId, upazilaId, areaId });
      if (!vr.ok) return res.status(400).json({ success: false, message: vr.message });
    }

    const before = await prisma.ownerProfile.findUnique({ where: { userId: ownerUserId } });

    const baseData = {
      name,
      nid: req.body?.nid ? String(req.body.nid).trim() : null,
      supportPhone: req.body?.supportPhone ? String(req.body.supportPhone).trim() : null,
      supportEmail: req.body?.supportEmail ? String(req.body.supportEmail).trim() : null,
      dateOfBirth: req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null,
      genderText: req.body?.genderText ? String(req.body.genderText).trim() : null,
      ...(addressJson !== null && addressJson !== undefined ? { addressJson } : {}),
    };

    const saved = await prisma.ownerProfile.upsert({
      where: { userId: ownerUserId },
      create: {
        userId: ownerUserId,
        ...baseData,
        divisionId: divisionId || null,
        districtId: districtId || null,
        upazilaId: upazilaId || null,
        areaId: areaId || null,
      },
      update: {
        ...baseData,
        divisionId: divisionId !== undefined ? divisionId : undefined,
        districtId: districtId !== undefined ? districtId : undefined,
        upazilaId: upazilaId !== undefined ? upazilaId : undefined,
        areaId: areaId !== undefined ? areaId : undefined,
      }
    });

    await writeAudit({
      prisma,
      req,
      action: 'OWNER_PROFILE_UPSERT',
      entityType: 'OWNER_PROFILE',
      entityId: saved.id,
      before,
      after: saved
    });

    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getOwnerKyc = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const kyc = await prisma.ownerKyc.findUnique({
      where: { userId: ownerUserId },
      include: {
        documents: {
          include: { media: true }
        }
      }
    });

    // Add secure proxy url so owner can preview uploaded documents immediately
    const baseUrl =
      process.env.PUBLIC_API_BASE_URL ||
      process.env.API_BASE_URL ||
      `http://localhost:${process.env.PORT || 3000}`;

    // ✅ Generate a short-lived signed token for file preview URLs.
    // <img> tags cannot send Authorization headers, so we attach ?token=... for preview.
    const jwt = require("jsonwebtoken");
    const appConfig = require("../../../../config/appConfig");

    const out = kyc
      ? {
          ...kyc,
          documents: (kyc.documents || []).map((d) => {
            const key = d?.media?.key ? String(d.media.key) : null;
            if (!key) return { ...d, url: null };

            const token = jwt.sign(
              { purpose: "FILE_VIEW", fileKey: key, userId: ownerUserId },
              appConfig.jwt.secret,
              { expiresIn: "20m" }
            );

            return {
              ...d,
              url: `${baseUrl}/api/v1/files/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`
            };
          })
        }
      : null;

    res.json({ success: true, data: out });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.upsertOwnerKycDraft = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Minimal required for draft: fullName (we keep schema strict, but draft is still an upsert).
    const fullName = req.body?.fullName ? String(req.body.fullName).trim() : '';
    if (!fullName) return res.status(400).json({ success: false, message: 'fullName is required' });

    const presentAddressJson = req.body?.presentAddressJson && typeof req.body.presentAddressJson === 'object' ? req.body.presentAddressJson : null;
    const permanentAddressJson = req.body?.permanentAddressJson && typeof req.body.permanentAddressJson === 'object' ? req.body.permanentAddressJson : null;
    const declarationsJson = req.body?.declarationsJson && typeof req.body.declarationsJson === 'object' ? req.body.declarationsJson : null;
    const businessIntentJson = req.body?.businessIntentJson && typeof req.body.businessIntentJson === 'object' ? req.body.businessIntentJson : null;

    const before = await prisma.ownerKyc.findUnique({ where: { userId: ownerUserId } });

    const saved = await prisma.ownerKyc.upsert({
      where: { userId: ownerUserId },
      create: {
        userId: ownerUserId,
        fullName,
        fatherName: req.body?.fatherName ? String(req.body.fatherName).trim() : null,
        motherName: req.body?.motherName ? String(req.body.motherName).trim() : null,
        dateOfBirth: req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null,
        genderText: req.body?.genderText ? String(req.body.genderText).trim() : null,
        nationality: req.body?.nationality ? String(req.body.nationality).trim() : 'Bangladeshi',
        nidNumber: req.body?.nidNumber ? String(req.body.nidNumber).trim() : null,
        nidIssueDate: req.body?.nidIssueDate ? new Date(req.body.nidIssueDate) : null,
        nidAddressRaw: req.body?.nidAddressRaw ? String(req.body.nidAddressRaw).trim() : null,
        mobile: req.body?.mobile ? String(req.body.mobile).trim() : null,
        email: req.body?.email ? String(req.body.email).trim() : null,
        presentAddressJson,
        permanentAddressJson,
        emergencyContactName: req.body?.emergencyContactName ? String(req.body.emergencyContactName).trim() : null,
        emergencyContactPhone: req.body?.emergencyContactPhone ? String(req.body.emergencyContactPhone).trim() : null,
        declarationsJson,
        businessIntentJson,
        verificationStatus: 'UNSUBMITTED'
      },
      update: {
        // Do not let users edit locked records
        ...(before?.isLocked ? {} : {
          fullName,
          fatherName: req.body?.fatherName ? String(req.body.fatherName).trim() : null,
          motherName: req.body?.motherName ? String(req.body.motherName).trim() : null,
          dateOfBirth: req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null,
          genderText: req.body?.genderText ? String(req.body.genderText).trim() : null,
          nationality: req.body?.nationality ? String(req.body.nationality).trim() : 'Bangladeshi',
          nidNumber: req.body?.nidNumber ? String(req.body.nidNumber).trim() : null,
          nidAddressRaw: req.body?.nidAddressRaw ? String(req.body.nidAddressRaw).trim() : null,
          mobile: req.body?.mobile ? String(req.body.mobile).trim() : null,
          email: req.body?.email ? String(req.body.email).trim() : null,
          presentAddressJson,
          permanentAddressJson,
          emergencyContactName: req.body?.emergencyContactName ? String(req.body.emergencyContactName).trim() : null,
          emergencyContactPhone: req.body?.emergencyContactPhone ? String(req.body.emergencyContactPhone).trim() : null,
          ...(declarationsJson !== undefined ? { declarationsJson } : {}),
          ...(businessIntentJson !== undefined ? { businessIntentJson } : {}),
        })
      }
    });

    await writeAudit({
      prisma,
      req,
      action: 'OWNER_KYC_DRAFT_UPSERT',
      entityType: 'OWNER_KYC',
      entityId: saved.id,
      before,
      after: saved
    });

    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// v1.2: Upload KYC document (creates Media + OwnerKycDocument)
// POST /api/v1/owner/kyc/documents (multipart/form-data)
// Body: type, docNumber?, issueDate?, expiryDate?, note?
// File field: file
exports.uploadOwnerKycDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const kyc = await prisma.ownerKyc.findUnique({ where: { userId: ownerUserId } });
    if (!kyc) return res.status(400).json({ success: false, message: 'KYC not found. Save draft first.' });
    if (kyc.isLocked) return res.status(403).json({ success: false, message: 'KYC is locked' });

    const type = normalizeDocType(req.body?.type);
    if (!type) return res.status(400).json({ success: false, message: 'type is required' });

    // Validate enum value safely: allowlist includes optional Trade License for Owner KYC v1
    const allowed = new Set([
      'NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID',
      'TRADE_LICENSE',
      'OTHER'
    ]);
    if (!allowed.has(type)) {
      return res.status(400).json({ success: false, message: `Invalid document type: ${type}` });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use multipart/form-data field name 'file'." });
    }

    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
    if (file.size && file.size > maxBytes) {
      return res.status(400).json({ success: false, message: `File size exceeds maximum (${maxBytes} bytes).` });
    }
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const mime = (file.mimetype || '').toLowerCase().trim();
    if (!allowedMimes.includes(mime)) {
      return res.status(400).json({ success: false, message: `Invalid file type. Allowed: ${allowedMimes.join(', ')}` });
    }

    const processed = await processUploadFile(file);
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId,
      file: processed,
      folder: 'owner-kyc'
    });

    const created = await prisma.ownerKycDocument.create({
      data: {
        ownerKycId: kyc.id,
        type,
        status: 'SUBMITTED',
        mediaId: media.id,
        docNumber: req.body?.docNumber ? String(req.body.docNumber).trim() : null,
        issueDate: parseDateOrNull(req.body?.issueDate),
        expiryDate: parseDateOrNull(req.body?.expiryDate),
        note: req.body?.note ? String(req.body.note).trim() : null
      },
      include: { media: true }
    });

    await writeAudit({
      prisma,
      req,
      action: 'OWNER_KYC_DOCUMENT_UPLOAD',
      entityType: 'OWNER_KYC',
      entityId: created.id,
      before: null,
      after: created
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    console.error('uploadOwnerKycDocument error:', e);
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// v1.2: Delete a KYC document (soft: delete record; media can stay for audit)
exports.deleteOwnerKycDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const docId = asIntId(req.params.id);
    if (!docId) return res.status(400).json({ success: false, message: 'Invalid id' });

    const doc = await prisma.ownerKycDocument.findFirst({
      where: {
        id: docId,
        ownerKyc: { userId: ownerUserId }
      }
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.ownerKycDocument.delete({ where: { id: docId } });

    await writeAudit({
      prisma,
      req,
      action: 'OWNER_KYC_DOCUMENT_DELETE',
      entityType: 'OWNER_KYC',
      entityId: docId,
      before: doc,
      after: null
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('deleteOwnerKycDocument error:', e);
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.submitOwnerKyc = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const current = await prisma.ownerKyc.findUnique({ where: { userId: ownerUserId } });
    if (!current) return res.status(400).json({ success: false, message: 'KYC not found. Save draft first.' });
    if (current.isLocked) return res.status(403).json({ success: false, message: 'KYC is locked' });

    // v1.2 submission checks:
    // - must have fullName
    // - must have required KYC documents uploaded (NID front/back + selfie)
    const fullName = current.fullName ? String(current.fullName).trim() : '';
    if (!fullName) return res.status(400).json({ success: false, message: 'fullName is required' });

    const docs = await prisma.ownerKycDocument.findMany({
      where: {
        ownerKycId: current.id,
        status: { in: ['SUBMITTED', 'VERIFIED'] }
      },
      select: { type: true }
    });

    const have = new Set(docs.map(d => String(d.type)));
    const missing = REQUIRED_OWNER_KYC_DOCS.filter(t => !have.has(t));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required documents: ${missing.join(', ')}`
      });
    }

    // Optional: require declarations (terms + info true) if frontend sends them
    const declarationsJson = req.body?.declarationsJson && typeof req.body.declarationsJson === 'object' ? req.body.declarationsJson : current.declarationsJson;
    const declarationsAccepted = declarationsJson && (
      (declarationsJson.termsAcceptedAt || declarationsJson.termsAccepted) &&
      (declarationsJson.infoTrueConfirmedAt || declarationsJson.infoTrueConfirmed)
    );
    if (req.body?.declarationsJson !== undefined && !declarationsAccepted) {
      return res.status(400).json({ success: false, message: 'Please accept terms and confirm information is true before submitting.' });
    }

    const submittedAt = new Date();
    const expiresAt = new Date(submittedAt.getTime() + KYC_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const before = current;
    const saved = await prisma.ownerKyc.update({
      where: { userId: ownerUserId },
      data: {
        verificationStatus: 'SUBMITTED',
        submittedAt,
        expiresAt,
        rejectionReason: null,
        reviewNote: null,
        ...(declarationsJson !== undefined ? { declarationsJson } : {})
      }
    });

    await writeAudit({
      prisma,
      req,
      action: 'OWNER_KYC_SUBMIT',
      entityType: 'OWNER_KYC',
      entityId: saved.id,
      before,
      after: saved
    });

    // Notifications: owner + admins (Owner KYC Upgrade Phase 1)
    try {
      const { createNotification } = require('../../services/notification.service');
      const ownerDashboardUrl = process.env.OWNER_APP_URL || process.env.PUBLIC_OWNER_APP_URL || 'http://localhost:3104';
      await createNotification({
        userId: ownerUserId,
        type: 'OWNER_KYC_SUBMITTED',
        title: 'KYC Submitted',
        message: 'Your KYC is under review. You can continue setting up branches and products while we review.',
        actionUrl: `${ownerDashboardUrl}/owner/kyc`,
        priority: 'P1',
        dedupeKey: `kyc_submitted:owner:${ownerUserId}`
      });

      // Notify admins (Super Admin whitelist): users whose email is in SuperAdminWhitelist
      const adminList = await prisma.superAdminWhitelist.findMany({
        where: { isActive: true, email: { not: null } },
        select: { email: true }
      });
      const adminEmails = adminList.map((r) => r.email).filter(Boolean);
      if (adminEmails.length > 0) {
        const adminUsers = await prisma.user.findMany({
          where: { auth: { email: { in: adminEmails } } },
          select: { id: true }
        });
        const adminAppUrl = process.env.ADMIN_APP_URL || process.env.PUBLIC_ADMIN_APP_URL || 'http://localhost:3103';
        const reviewUrl = `${adminAppUrl}/admin/verifications`;
        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: 'OWNER_KYC_SUBMITTED',
            title: 'New Owner KYC submission',
            message: `Owner KYC #${saved.id} (${current.fullName}) submitted for review.`,
            actionUrl: reviewUrl,
            priority: 'P2',
            dedupeKey: `kyc_submitted:admin:${admin.id}:${saved.id}`
          });
        }
      }
    } catch (notifErr) {
      console.warn('[submitOwnerKyc] notification failed', (notifErr && notifErr.message) || notifErr);
    }

    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.createOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const name = req.body?.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    // Check for duplicates
    const existing = await prisma.organization.findFirst({
      where: {
        ownerUserId,
        name: { equals: name, mode: 'insensitive' },
        status: { notIn: ['SUSPENDED', 'REJECTED'] }
      }
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Organization with this name already exists' });
    }

    // This project already uses Organization.status = PartnerStatus
    // We'll store location + extra fields inside addressJson to keep DB stable.
    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : {};
    const { validateAndNormalizeLocation, locationFromAddressJson } = require('./utils/locationValidation');
    let locationData = null;
    if (req.body?.location && typeof req.body.location === 'object') {
      try {
        locationData = validateAndNormalizeLocation(req.body.location);
      } catch (locErr) {
        return res.status(400).json({ success: false, message: locErr.message });
      }
    }
    if (!locationData && addressJson && (addressJson.latitude != null || addressJson.longitude != null)) {
      try {
        locationData = locationFromAddressJson(addressJson);
      } catch {
        locationData = null;
      }
    }
    const ctx = req.countryContext || {};
    let countryId = ctx.countryId || null;
    if (!countryId) {
      const code = String(ctx.countryCode || req.headers?.["x-country-code"] || "BD").toUpperCase().trim();
      const country = await prisma.country.findUnique({ where: { code }, select: { id: true } });
      countryId = country?.id || null;
    }
    if (!countryId) {
      return res.status(400).json({ success: false, message: 'Country not resolved for organization' });
    }

    const created = await prisma.organization.create({
      data: {
        ownerUserId,
        name,
        supportPhone: req.body?.supportPhone ? String(req.body.supportPhone).trim() : null,
        // email is not in current Organization model; keep inside addressJson
        status: 'NOT_APPLIED',
        countryId,
        addressJson: {
          ...addressJson,
          email: req.body?.email ? String(req.body.email).trim() : null,
          // Dhaka (optional)
          cityCorporationId: asIntId(req.body?.cityCorporationId),
          dhakaAreaId: asIntId(req.body?.areaId) || asIntId(req.body?.dhakaAreaId),

          // National BD hierarchy (preferred)
          divisionId: asIntId(req.body?.divisionId),
          districtId: asIntId(req.body?.districtId),
          upazilaId: asIntId(req.body?.upazilaId),
          bdAreaId: asIntId(req.body?.bdAreaId),

          // Cached text for UI
          fullPathText: req.body?.fullPathText ? String(req.body.fullPathText) : addressJson?.fullPathText || null,
        },
        location: locationData ? locationData : {},
      }
    });

    await writeAudit({
      prisma,
      req,
      action: 'ORG_CREATE',
      entityType: 'ORGANIZATION',
      entityId: created.id,
      before: null,
      after: created
    });

    res.json({ success: true, data: created });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listOrganizations = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id || req.auth?.userId);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let status = req.query.status ? String(req.query.status).trim() : null;
    if (status === '') status = null;

    const VALID_PARTNER_STATUSES = ['NOT_APPLIED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];
    if (status && !VALID_PARTNER_STATUSES.includes(status)) {
       return res.json({ success: true, data: [] });
    }

    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prisma, userId);
    if (orgIds.length === 0) return res.json({ success: true, data: [] });

    const rows = await prisma.organization.findMany({
      where: {
        id: { in: orgIds },
        ...(status ? { status } : {})
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listOrganizations error:", e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.deleteOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    // Archive = SUSPENDED
    const updated = await prisma.organization.update({
      where: { id },
      data: { status: 'SUSPENDED' }
    });

    await writeAudit({ prisma, req, action: 'ORG_ARCHIVE', entityType: 'ORGANIZATION', entityId: id, before: org, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    console.error("deleteOrganization error:", e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id || req.auth?.userId);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prisma, userId);
    if (!orgIds.length || !orgIds.includes(id)) return res.status(404).json({ success: false, message: 'Organization not found' });

    const org = await prisma.organization.findFirst({
      where: { id },
      include: {
        branches: true,
        legalProfile: {
          include: {
            documents: true,
            directors: true,
          },
        }
      }
    });

    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
    // Convenience: expose email if stored under addressJson
    const data = {
      ...org,
      email: org?.addressJson && typeof org.addressJson === 'object' ? (org.addressJson.email || null) : null,
    };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.updateOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    // V3.1 Soft/Hard Gate (legacy endpoint): do not break Flutter.
    // If org is under verification (PENDING_REVIEW) or already approved, we block with 409 only when hard-lock is enabled.
    // Otherwise we save the user's intended changes into VerificationCase.payloadJson as a draft and return a warning.
    const isLockedByVerification = org.status === 'PENDING_REVIEW' || org.status === 'APPROVED';
    if (isLockedByVerification) {
      const verification = buildVerificationSignal({
        locked: true,
        status: org.status,
        message:
          org.status === 'PENDING_REVIEW'
            ? 'Organization is under verification review. Direct edits are locked; your changes were saved as a draft for re-verification.'
            : 'Organization is approved. Direct edits require re-verification; your changes were saved as a draft change request.',
        action: 'REQUEST_CHANGE',
      });

      if (isVerificationHardLockEnabled()) {
        return res.status(409).json({
          success: false,
          code: 'VERIFICATION_LOCKED',
          message: verification.message,
          verification,
        });
      }

      // Soft mode: save as draft in the universal verification system.
      const payloadJson = req.body && typeof req.body === 'object' ? req.body : null;
      const draft = await saveVerificationDraftFromLegacy(prisma, {
        entityType: 'ORGANIZATION',
        entityId: id,
        payloadJson,
      });

      verification.case = { id: draft.id, status: draft.status };
      return res.json({ success: true, data: org, verification });
    }

    if (!assertOrgEditable(org.status)) return res.status(400).json({ success: false, message: `Cannot edit when status=${org.status}` });

    const before = org;

    const mergedAddress = {
      ...(org.addressJson && typeof org.addressJson === 'object' ? org.addressJson : {}),
      ...(req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : {}),
    };
    if (req.body?.email !== undefined) mergedAddress.email = req.body.email ? String(req.body.email).trim() : null;

    // Location fields used across Next.js + Flutter (keep in addressJson only)
    if (req.body?.locationKind !== undefined) mergedAddress.locationKind = req.body.locationKind ? String(req.body.locationKind) : null;
    if (req.body?.cityCorporationId !== undefined) mergedAddress.cityCorporationId = asIntId(req.body.cityCorporationId);
    if (req.body?.cityCorporationCode !== undefined) mergedAddress.cityCorporationCode = req.body.cityCorporationCode ? String(req.body.cityCorporationCode) : null;

    // Dhaka area picker
    if (req.body?.dhakaAreaId !== undefined) mergedAddress.dhakaAreaId = asIntId(req.body.dhakaAreaId);
    if (req.body?.areaId !== undefined) mergedAddress.areaId = asIntId(req.body.areaId);

    // National BD hierarchy
    if (req.body?.divisionId !== undefined) mergedAddress.divisionId = asIntId(req.body.divisionId);
    if (req.body?.districtId !== undefined) mergedAddress.districtId = asIntId(req.body.districtId);
    if (req.body?.upazilaId !== undefined) mergedAddress.upazilaId = asIntId(req.body.upazilaId);
    if (req.body?.bdAreaId !== undefined) mergedAddress.bdAreaId = asIntId(req.body.bdAreaId);

    if (req.body?.fullPathText !== undefined) mergedAddress.fullPathText = req.body.fullPathText ? String(req.body.fullPathText) : null;

    // If the org is under review and the owner edits details, move it back to draft
    // so the owner explicitly re-submits the latest info.
    const nextStatus = org.status === 'PENDING_REVIEW' ? 'NOT_APPLIED' : org.status;

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        name: req.body?.name ? String(req.body.name).trim() : org.name,
        supportPhone: req.body?.supportPhone !== undefined ? (req.body.supportPhone ? String(req.body.supportPhone).trim() : null) : org.supportPhone,
        status: nextStatus,
        addressJson: mergedAddress
      }
    });

    await writeAudit({ prisma, req, action: 'ORG_UPDATE', entityType: 'ORGANIZATION', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.submitOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
    if (!(org.status === 'NOT_APPLIED' || org.status === 'REJECTED')) {
      return res.status(400).json({ success: false, message: `Cannot submit when status=${org.status}` });
    }

    const before = org;

    const updated = await prisma.organization.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });

    await writeAudit({ prisma, req, action: 'ORG_SUBMIT', entityType: 'ORGANIZATION', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.cancelOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, id);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
    if (org.status === 'APPROVED') return res.status(400).json({ success: false, message: 'Approved organization cannot be cancelled' });

    const before = org;
    const cancelReason = req.body?.reason ? String(req.body.reason).trim() : null;

    const updated = await prisma.organization.update({ where: { id }, data: { status: 'NOT_APPLIED' } });

    // store cancel reason into addressJson (non-breaking)
    const mergedAddress = {
      ...(org.addressJson && typeof org.addressJson === 'object' ? org.addressJson : {}),
      cancelReason,
      cancelledAt: new Date().toISOString(),
    };
    await prisma.organization.update({ where: { id }, data: { addressJson: mergedAddress } });

    await writeAudit({ prisma, req, action: 'ORG_CANCEL', entityType: 'ORGANIZATION', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ----------------------------
// v1.3: Organization Legal Profile (Owner wizard)
// ----------------------------

exports.saveOrgLegalDraft = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.id);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid organization id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    // Editing directors implies a revised submission if previously submitted/rejected.
    await markOrgLegalAsDraftIfNeeded(prisma, orgId);

    // Uploading/replacing a document implies a revised submission if previously submitted/rejected.
    await markOrgLegalAsDraftIfNeeded(prisma, orgId);

    // Editing directors implies a revised submission if previously submitted/rejected.
    // If owner is editing while a previous submission is pending/rejected, move legal profile back to draft.
    await markOrgLegalAsDraftIfNeeded(prisma, orgId);

    // Keep this tolerant: store known fields if they exist in schema; otherwise store in a JSON blob.
    const payload = req.body && typeof req.body === 'object' ? req.body : {};

    // Attempt to update common columns; ignore unknowns by falling back to infoJson.
    let saved = null;
    try {
      saved = await upsertOrgLegalProfile(prisma, orgId, {
        registrationType: payload.registrationType || null,
        tradeLicenseNumber: payload.tradeLicenseNumber || null,
        issuingAuthority: payload.issuingAuthority || null,
        tinNumber: payload.tinNumber || null,
        binNumber: payload.binNumber || null,
        officialEmail: payload.officialEmail || null,
        website: payload.website || null,
        facebookPage: payload.facebookPage || null,
        officialPhone: payload.officialPhone || payload.supportPhone || null,
        organizationName: payload.organizationName || payload.name || null,
      });
    } catch (e) {
      // Fallback for schemas without these columns
      saved = await upsertOrgLegalProfile(prisma, orgId, {
        infoJson: payload,
      });
    }

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.saveOrgLegalDirectors = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.id);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid organization id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const directors = Array.isArray(req.body?.directors) ? req.body.directors : [];
    const lp = await upsertOrgLegalProfile(prisma, orgId, {});

    const directorDelegate = pickDelegate(prisma, [
      'organizationDirector',
      'organizationLegalProfileDirector',
      'organizationLegalDirector'
    ]);

    if (!directorDelegate) {
      // If schema doesn't support directors table, store in JSON.
      const saved = await upsertOrgLegalProfile(prisma, orgId, { directorsJson: directors });
      return res.json({ success: true, data: saved });
    }

    // Replace-all strategy: delete existing then insert.
    // Try common FK names (current schema uses orgLegalProfileId)
    await directorDelegate.deleteMany({ where: { orgLegalProfileId: lp.id } }).catch(() => null);
    await directorDelegate.deleteMany({ where: { legalProfileId: lp.id } }).catch(() => null);
    if (directors.length) {
      const rows = directors.map((d) => ({
        orgLegalProfileId: lp.id,
        name: d?.name ? String(d.name).trim() : 'Unnamed',
        role: d?.role ? String(d.role).trim() : null,
        mobile: d?.mobile ? String(d.mobile).trim() : null,
        email: d?.email ? String(d.email).trim() : null,
      }));
      try {
        await directorDelegate.createMany({ data: rows, skipDuplicates: true });
      } catch (_) {
        // Fallback FK name
        await directorDelegate.createMany({
          data: rows.map((r) => {
            const { orgLegalProfileId, ...rest } = r;
            return { legalProfileId: orgLegalProfileId, ...rest };
          }),
          skipDuplicates: true,
        });
      }
    }

    const row = await prisma.organizationLegalProfile.findUnique({ where: { id: lp.id }, include: { directors: true } });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.addOrgLegalDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.id);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid organization id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const type = normalizeDocType(req.body?.type);
    const mediaId = asIntId(req.body?.mediaId);
    if (!type) return res.status(400).json({ success: false, message: 'type is required' });
    if (!mediaId) return res.status(400).json({ success: false, message: 'mediaId is required' });

    const lp = await upsertOrgLegalProfile(prisma, orgId, {});

    // Current schema uses `organizationDocument` (mapped to org_documents)
    const docDelegate = pickDelegate(prisma, [
      'organizationDocument',
      'organizationLegalProfileDocument',
      'organizationLegalDocument',
      'orgLegalProfileDocument'
    ]);

    if (!docDelegate) {
      return res.status(500).json({ success: false, message: 'Document table delegate not found in Prisma client' });
    }

    // Try common FK field names
    let created = null;
    const candidates = [
      { legalProfileId: lp.id, type, mediaId },
      { orgLegalProfileId: lp.id, type, mediaId },
      { profileId: lp.id, type, mediaId },
    ];
    for (const data of candidates) {
      try {
        created = await docDelegate.create({ data, select: { id: true, type: true, mediaId: true } });
        break;
      } catch (_) {
        // continue
      }
    }
    if (!created) return res.status(500).json({ success: false, message: 'Failed to attach document (schema mismatch)' });

    return res.json({ success: true, data: created });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.submitOrgLegalProfile = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.id);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid organization id' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const lp = await upsertOrgLegalProfile(prisma, orgId, { submittedAt: new Date(), verificationStatus: 'SUBMITTED' });

    // Keep org status aligned for Owner UX
    await prisma.organization.update({ where: { id: orgId }, data: { status: 'PENDING_REVIEW' } });

    return res.json({ success: true, data: lp });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// Branches
exports.createBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.orgId);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid orgId' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const name = req.body?.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const typeCodes = Array.isArray(req.body?.typeCodes) ? req.body.typeCodes.map(String) : [];

    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : {};

    const created = await prisma.branch.create({
      data: {
        orgId,
        name,
        status: 'DRAFT',
        verificationStatus: 'UNSUBMITTED',
        addressJson: {
          ...addressJson,
          // Dhaka (optional)
          cityCorporationId: asIntId(req.body?.cityCorporationId),
          dhakaAreaId: asIntId(req.body?.areaId) || asIntId(req.body?.dhakaAreaId),

          // National BD hierarchy (preferred)
          divisionId: asIntId(req.body?.divisionId),
          districtId: asIntId(req.body?.districtId),
          upazilaId: asIntId(req.body?.upazilaId),
          bdAreaId: asIntId(req.body?.bdAreaId),

          // Cached text for UI
          fullPathText: req.body?.fullPathText ? String(req.body.fullPathText) : addressJson?.fullPathText || null,
        },
      }
    });

    // Link branch types
    if (typeCodes.length) {
      const types = await prisma.branchType.findMany({ where: { code: { in: typeCodes } }, select: { id: true } });
      if (types.length) {
        await prisma.branchToType.createMany({
          data: types.map((t) => ({ branchId: created.id, typeId: t.id })),
          skipDuplicates: true,
        });
      }
    }

    await writeAudit({ prisma, req, action: 'BRANCH_CREATE', entityType: 'BRANCH', entityId: created.id, before: null, after: created });

    res.json({ success: true, data: created });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listBranches = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const orgId = asIntId(req.params.orgId);
    if (!orgId) return res.status(400).json({ success: false, message: 'Invalid orgId' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const rows = await prisma.branch.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};


// =====================================================
// GET /api/v1/owner/branches
// Aggregated branches list for Owner dashboard sidebar & branches page
// - Returns all branches under organizations owned by the current OWNER user
// =====================================================
exports.listOwnerBranchesAll = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id || req.auth?.userId);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const branchIds = await getEffectiveBranchIdsForOwnerPanel(prisma, userId);
    if (branchIds.length === 0) return res.json({ success: true, data: [] });

    const rows = await prisma.branch.findMany({
      where: { id: { in: branchIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        org: { select: { id: true, name: true } },
      },
    });

    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const branch = await prisma.branch.findFirst({
      where: {
        id,
        org: { ownerUserId }
      },
      include: {
        org: true,
        types: { include: { type: true } },
        profileDetails: {
          include: {
            documents: {
              include: {
                media: true,
              },
              orderBy: { id: 'desc' },
            },
          },
        }
      }
    });

    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.json({ success: true, data: branch });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const branch = await prisma.branch.findFirst({ where: { id, org: { ownerUserId } } });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    // V3.1 Soft/Hard Gate (legacy endpoint): do not break Flutter.
    // When the branch is under review/submitted (PENDING_REVIEW / SUBMITTED) or already verified, block only in hard-lock mode.
    // In soft mode, capture intended changes into VerificationCase.payloadJson.
    const isLockedByVerification =
      branch.status === 'PENDING_REVIEW' ||
      branch.verificationStatus === 'SUBMITTED' ||
      branch.verificationStatus === 'VERIFIED';
    if (isLockedByVerification) {
      const lockedStatus = branch.verificationStatus || branch.status;
      const verification = buildVerificationSignal({
        locked: true,
        status: lockedStatus,
        message:
          lockedStatus === 'SUBMITTED' || branch.status === 'PENDING_REVIEW'
            ? 'Branch is under verification review. Direct edits are locked; your changes were saved as a draft for re-verification.'
            : 'Branch is verified/approved. Direct edits require re-verification; your changes were saved as a draft change request.',
        action: 'REQUEST_CHANGE',
      });

      if (isVerificationHardLockEnabled()) {
        return res.status(409).json({
          success: false,
          code: 'VERIFICATION_LOCKED',
          message: verification.message,
          verification,
        });
      }

      const payloadJson = req.body && typeof req.body === 'object' ? req.body : null;
      const draft = await saveVerificationDraftFromLegacy(prisma, {
        entityType: 'BRANCH',
        entityId: id,
        payloadJson,
      });
      verification.case = { id: draft.id, status: draft.status };
      return res.json({ success: true, data: branch, verification });
    }

    if (!assertBranchEditable(branch.status)) return res.status(400).json({ success: false, message: `Cannot edit when status=${branch.status}` });

    const before = branch;

    const mergedAddress = {
      ...(branch.addressJson && typeof branch.addressJson === 'object' ? branch.addressJson : {}),
      ...(req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : {}),
    };
    if (req.body?.cityCorporationId !== undefined) mergedAddress.cityCorporationId = asIntId(req.body.cityCorporationId);
    if (req.body?.areaId !== undefined) mergedAddress.areaId = asIntId(req.body.areaId);

    const updated = await prisma.branch.update({
      where: { id },
      data: {
        name: req.body?.name ? String(req.body.name).trim() : branch.name,
        addressJson: mergedAddress
      }
    });

    // Also keep BranchProfileDetails in sync for editable profile fields.
    // Owner Panel edit form sends phone/email at top-level.
    const phone = req.body?.phone !== undefined && req.body?.phone !== null ? String(req.body.phone).trim() : null;
    const email = req.body?.email !== undefined && req.body?.email !== null ? String(req.body.email).trim() : null;
    await upsertBranchProfileDetails(prisma, id, {
      ...(phone !== null ? { branchPhone: phone || null } : {}),
      ...(email !== null ? { branchEmail: email || null } : {}),
      // Keep location snapshot too (non-breaking). If you use dedicated location wizard, it can overwrite this.
      addressJson: mergedAddress,
    }).catch(() => null);

    // Update branch types links (optional)
    if (Array.isArray(req.body?.typeCodes)) {
      const typeCodes = req.body.typeCodes.map(String);
      await prisma.branchToType.deleteMany({ where: { branchId: id } });
      if (typeCodes.length) {
        const types = await prisma.branchType.findMany({ where: { code: { in: typeCodes } }, select: { id: true } });
        if (types.length) {
          await prisma.branchToType.createMany({
            data: types.map((t) => ({ branchId: id, typeId: t.id })),
            skipDuplicates: true,
          });
        }
      }
    }

    await writeAudit({ prisma, req, action: 'BRANCH_UPDATE', entityType: 'BRANCH', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ----------------------------
// v1.x: Branch Profile Wizard (Owner Panel)
// ----------------------------

// POST /api/v1/owner/branches/:id/profile/save-draft
exports.saveBranchProfileDraft = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const branchId = asIntId(req.params.id);
    if (!branchId) return res.status(400).json({ success: false, message: 'Invalid branch id' });

    const branch = await ensureOwnerBranch(prisma, ownerUserId, branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : undefined;
    // best-effort: validate location refs if they exist on the payload
    if (addressJson) {
      const kind = String(addressJson.kind || '').toUpperCase();
      const hasBdArea = !!(addressJson.bdAreaId || (addressJson.areaId && !addressJson.dhakaAreaId && !addressJson.cityCorporationId));
      const hasDhakaArea = !!(addressJson.dhakaAreaId || addressJson.cityCorporationId);

      // Validate BD_AREA locations (only if it's clearly a BD location, not Dhaka)
      if ((kind === 'BD_AREA' || hasBdArea) && !hasDhakaArea) {
        // Support both bdAreaId and areaId for backward compatibility
        const areaId = asIntId(addressJson.areaId) || asIntId(addressJson.bdAreaId);
        if (areaId) {
          const vr = await validateBdLocationRefs(prisma, {
            divisionId: asIntId(addressJson.divisionId),
            districtId: asIntId(addressJson.districtId),
            upazilaId: asIntId(addressJson.upazilaId),
            areaId: areaId,
          });
          if (!vr.ok) return res.status(400).json({ success: false, message: vr.message });
        }
      }

      // Validate DHAKA_AREA locations (only if it's clearly a Dhaka location)
      if (kind === 'DHAKA_AREA' || hasDhakaArea) {
        const dhakaAreaId = asIntId(addressJson.dhakaAreaId);
        const cityCorpId = asIntId(addressJson.cityCorporationId);
        // Validate city corporation if provided
        if (cityCorpId) {
          const corp = await prisma.cityCorporation.findUnique({ where: { id: cityCorpId } });
          if (!corp) {
            return res.status(400).json({ success: false, message: 'Invalid cityCorporationId' });
          }
        }
        // Validate Dhaka area if provided
        if (dhakaAreaId) {
          const area = await prisma.area.findUnique({ where: { id: dhakaAreaId } });
          if (!area) {
            return res.status(400).json({ success: false, message: 'Invalid dhakaAreaId' });
          }
          // Verify area belongs to the city corporation if both are provided
          if (cityCorpId && area.cityCorporationId !== cityCorpId) {
            return res.status(400).json({ success: false, message: 'Area does not belong to the specified city corporation' });
          }
        }
      }
    }

    // Optional location fields (BranchProfileDetails): latitude, longitude, coverageRadiusKm, coveragePolygon
    let latitude; let longitude; let coverageRadiusKm; let coveragePolygon;
    if (req.body?.latitude !== undefined) {
      const v = Number(req.body.latitude);
      latitude = Number.isFinite(v) ? v : null;
    }
    if (req.body?.longitude !== undefined) {
      const v = Number(req.body.longitude);
      longitude = Number.isFinite(v) ? v : null;
    }
    if (req.body?.coverageRadiusKm !== undefined) {
      const v = Number(req.body.coverageRadiusKm);
      coverageRadiusKm = Number.isFinite(v) && v >= 0 ? v : null;
    }
    if (req.body?.coveragePolygon !== undefined) {
      coveragePolygon = typeof req.body.coveragePolygon === 'object' && req.body.coveragePolygon !== null
        ? req.body.coveragePolygon
        : null;
    }

    const saved = await upsertBranchProfileDetails(prisma, branchId, {
      branchPhone: req.body?.branchPhone !== undefined ? String(req.body.branchPhone || '').trim() : undefined,
      branchEmail: req.body?.branchEmail !== undefined ? String(req.body.branchEmail || '').trim() : undefined,
      managerName: req.body?.managerName !== undefined ? String(req.body.managerName || '').trim() : undefined,
      managerPhone: req.body?.managerPhone !== undefined ? String(req.body.managerPhone || '').trim() : undefined,
      addressJson,
      googleMapLink: req.body?.googleMapLink !== undefined ? String(req.body.googleMapLink || '').trim() : undefined,
      ...(latitude !== undefined && { latitude }),
      ...(longitude !== undefined && { longitude }),
      ...(coverageRadiusKm !== undefined && { coverageRadiusKm }),
      ...(coveragePolygon !== undefined && { coveragePolygon }),
    });

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// POST /api/v1/owner/branches/:id/profile/add-document
exports.addBranchProfileDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const branchId = asIntId(req.params.id);
    if (!branchId) return res.status(400).json({ success: false, message: 'Invalid branch id' });

    const branch = await ensureOwnerBranch(prisma, ownerUserId, branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const type = normalizeDocType(req.body?.type);
    const mediaId = asIntId(req.body?.mediaId);
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    if (!type) return res.status(400).json({ success: false, message: 'type is required' });
    if (!mediaId) return res.status(400).json({ success: false, message: 'mediaId is required' });

    const profile = await upsertBranchProfileDetails(prisma, branchId, {});

    const created = await prisma.branchDocument.create({
      data: {
        branchProfileId: profile.id,
        type,
        mediaId,
        ...(note ? { note } : {}),
      },
      select: { id: true, type: true, mediaId: true, note: true },
    });

    return res.json({ success: true, data: created });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// POST /api/v1/owner/branches/:id/profile/submit
exports.submitBranchProfile = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const branchId = asIntId(req.params.id);
    if (!branchId) return res.status(400).json({ success: false, message: 'Invalid branch id' });

    const branch = await ensureOwnerBranch(prisma, ownerUserId, branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const profile = await upsertBranchProfileDetails(prisma, branchId, {});
    const docs = await prisma.branchDocument.findMany({
      where: { branchProfileId: profile.id },
      select: { type: true },
    });
    const types = new Set((docs || []).map((d) => String(d.type)));

    // Minimum requirements for verification queue
    if (!types.has('STORE_FRONT_PHOTO') || !types.has('SIGNBOARD_PHOTO')) {
      return res.status(400).json({
        success: false,
        message: 'Storefront photo and Signboard photo are required before submit',
      });
    }
    const addr = profile.addressJson && typeof profile.addressJson === 'object' ? profile.addressJson : null;
    if (!addr) {
      return res.status(400).json({ success: false, message: 'Location/address is required before submit' });
    }

    const updatedProfile = await prisma.branchProfileDetails.update({
      where: { id: profile.id },
      data: {
        verificationStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    // Keep Branch status/verificationStatus aligned for Admin queues.
    await prisma.branch.update({
      where: { id: branchId },
      data: { status: 'PENDING_REVIEW', verificationStatus: 'SUBMITTED' },
    }).catch(() => null);

    return res.json({ success: true, data: updatedProfile });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.submitBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const branch = await prisma.branch.findFirst({ where: { id, org: { ownerUserId } } });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    if (!(branch.status === 'DRAFT' || branch.status === 'INACTIVE' || branch.status === 'BLOCKED')) {
      return res.status(400).json({ success: false, message: `Cannot submit when status=${branch.status}` });
    }

    const before = branch;

    const updated = await prisma.branch.update({
      where: { id },
      data: { status: 'PENDING_REVIEW', verificationStatus: 'SUBMITTED' }
    });

    await writeAudit({ prisma, req, action: 'BRANCH_SUBMIT', entityType: 'BRANCH', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.cancelBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const branch = await prisma.branch.findFirst({ where: { id, org: { ownerUserId } } });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    if (branch.status === 'ACTIVE') return res.status(400).json({ success: false, message: 'Active branch cannot be cancelled' });

    const before = branch;
    const cancelReason = req.body?.reason ? String(req.body.reason).trim() : null;

    const updated = await prisma.branch.update({ where: { id }, data: { status: 'INACTIVE' } });

    const mergedAddress = {
      ...(branch.addressJson && typeof branch.addressJson === 'object' ? branch.addressJson : {}),
      cancelReason,
      cancelledAt: new Date().toISOString(),
    };
    await prisma.branch.update({ where: { id }, data: { addressJson: mergedAddress } });

    await writeAudit({ prisma, req, action: 'BRANCH_CANCEL', entityType: 'BRANCH', entityId: id, before, after: updated });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};


/* ================================
 * BPA PATCH: Branch Members + Product Change Requests
 * ================================ */

const prismaClient = require("../../../../infrastructure/db/prismaClient");

function hasDeliveryHubType(branch) {
  const links = branch?.types || [];
  return links.some((x) => String(x?.type?.code || "").toUpperCase() === "DELIVERY_HUB");
}

function isRoleAllowedForBranch(isDeliveryHub, role) {
  const r = String(role || "");
  if (["OWNER", "ORG_ADMIN"].includes(r)) return false;
  if (isDeliveryHub) return ["DELIVERY_MANAGER", "DELIVERY_STAFF"].includes(r);
  return ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"].includes(r);
}

// GET /api/v1/owner/branches/:id/members
exports.listBranchMembers = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const branch = await prismaClient.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        orgId: true,
        name: true,
        types: { select: { type: { select: { code: true } } } },
      },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const members = await prismaClient.branchMember.findMany({
      where: { branchId },
      select: {
        id: true,
        orgId: true,
        branchId: true,
        userId: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, profile: { select: { displayName: true,  } }, auth: { select: { phone: true, email: true } } } },
      },
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, data: { branch, members } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict" });
    }
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// POST /api/v1/owner/branches/:id/members
exports.addBranchMember = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const { userId, role, status } = req.body || {};

    if (!userId || !role) {
      return res.status(400).json({
        success: false,
        message: "userId and role are required. If user does not exist, use /branches/:id/members/invite with phone/email.",
      });
    }

    const branch = await prismaClient.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        orgId: true,
        types: { select: { type: { select: { code: true } } } },
      },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const isDeliveryHub = hasDeliveryHubType(branch);
    if (!isRoleAllowedForBranch(isDeliveryHub, role)) {
      return res.status(400).json({ success: false, message: "Invalid role for this branch type" });
    }

    const row = await prismaClient.branchMember.create({
      data: {
        orgId: branch.orgId,
        branchId,
        userId: Number(userId),
        role: String(role),
        status: status ? String(status) : "ACTIVE",
        invitedByUserId: req.user.id,
      },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "User already exists in this branch" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};// PATCH /api/v1/owner/branches/:id/members/:memberId
exports.updateBranchMember = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    const { role, status } = req.body || {};

    const branch = await prismaClient.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        orgId: true,
        types: { select: { type: { select: { code: true } } } },
      },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const isDeliveryHub = hasDeliveryHubType(branch);
    if (role && !isRoleAllowedForBranch(isDeliveryHub, role)) {
      return res.status(400).json({ success: false, message: "Invalid role for this branch type" });
    }

    const updated = await prismaClient.branchMember.update({
      where: { id: memberId },
      data: {
        ...(role ? { role: String(role) } : {}),
        ...(status ? { status: String(status) } : {}),
      },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict" });
    }
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// GET /api/v1/owner/product-change-requests?status=PENDING|APPROVED|REJECTED|ALL
exports.listProductChangeRequests = async (req, res) => {
  try {
    const statusParam = String(req.query.status || "PENDING").toUpperCase();
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prismaClient, ownerUserId);
    if (!orgIds.length) {
      return res.json({ success: true, data: [] });
    }
    const where: { orgId: { in: number[] }; status?: string } = { orgId: { in: orgIds } };
    if (statusParam !== "ALL" && statusParam !== "") {
      where.status = statusParam;
    }
    const rows = await prismaClient.productChangeRequest.findMany({
      where,
      select: {
        id: true,
        orgId: true,
        type: true,
        status: true,
        payload: true,
        note: true,
        createdAt: true,
        reviewedAt: true,
        requestedBy: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
        requestedFromBranch: { select: { id: true, name: true } },
      },
      orderBy: { id: "desc" },
      take: 200,
    });

    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/v1/owner/product-change-requests/:id
exports.getProductChangeRequest = async (req, res) => {
  try {
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prismaClient, ownerUserId);
    if (!orgIds.length) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    const row = await prismaClient.productChangeRequest.findFirst({
      where: { id, orgId: { in: orgIds } },
      select: {
        id: true,
        orgId: true,
        type: true,
        status: true,
        payload: true,
        note: true,
        createdAt: true,
        reviewedAt: true,
        requestedBy: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
        requestedFromBranch: { select: { id: true, name: true } },
      },
    });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

async function applyApprovedProductRequest(prismaTx, reqRow) {
  const payload = reqRow.payload || {};
  const type = reqRow.type;

  if (type === "CREATE_PRODUCT") {
    const orgId = payload.orgId || reqRow.orgId;
    const product = await prismaTx.product.create({
      data: {
        orgId: Number(orgId),
        name: String(payload.name || ""),
        slug: String(payload.slug || ""),
        status: "ACTIVE",
        createdByUserId: reqRow.requestedByUserId,
        variants: payload.variants
          ? {
              create: payload.variants.map((v) => ({
                sku: String(v.sku),
                title: String(v.title || v.sku),
                attributes: v.attributes || null,
                isActive: true,
              })),
            }
          : undefined,
      },
      include: { variants: true },
    });
    return { product };
  }

  if (type === "CREATE_VARIANT") {
    // payload must include productId
    const variant = await prismaTx.productVariant.create({
      data: {
        productId: Number(payload.productId),
        sku: String(payload.sku),
        title: String(payload.title || payload.sku),
        attributes: payload.attributes || null,
        isActive: true,
      },
    });
    return { variant };
  }

  // EDIT_PRODUCT: minimal - update name/slug/status
  if (type === "EDIT_PRODUCT") {
    const updated = await prismaTx.product.update({
      where: { id: Number(payload.productId) },
      data: {
        ...(payload.name ? { name: String(payload.name) } : {}),
        ...(payload.slug ? { slug: String(payload.slug) } : {}),
        ...(payload.status ? { status: String(payload.status) } : {}),
      },
    });
    return { product: updated };
  }

  return {};
}

// PATCH /api/v1/owner/product-change-requests/:id/approve
exports.approveProductChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note;

    const row = await prismaClient.productChangeRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.status !== "PENDING") return res.status(400).json({ success: false, message: "Only PENDING requests can be approved" });

    const result = await prismaClient.$transaction(async (tx) => {
      const applied = await applyApprovedProductRequest(tx, row);
      const updated = await tx.productChangeRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedByUserId: req.user.id,
          reviewedAt: new Date(),
          ...(note ? { note: String(note) } : {}),
        },
      });
      return { applied, updated };
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    // unique slug conflict etc
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict: unique constraint failed (slug/sku)" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /api/v1/owner/product-change-requests/:id/reject
exports.rejectProductChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note;

    const row = await prismaClient.productChangeRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.status !== "PENDING") return res.status(400).json({ success: false, message: "Only PENDING requests can be rejected" });

    const updated = await prismaClient.productChangeRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedByUserId: req.user.id,
        reviewedAt: new Date(),
        ...(note ? { note: String(note) } : {}),
      },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Stock Adjustment Requests (Owner Panel)
const ledgerService = require("../inventory/ledger.service");

exports.listStockAdjustmentRequests = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prismaClient, ownerUserId);
    if (!orgIds.length) {
      return res.json({ success: true, data: [] });
    }
    const statusParam = String(req.query.status || "PENDING").toUpperCase();
    const where: { orgId: { in: number[] }; status?: string } = { orgId: { in: orgIds } };
    if (statusParam !== "ALL" && statusParam !== "") {
      where.status = statusParam;
    }
    const rows = await prismaClient.stockAdjustmentRequest.findMany({
      where,
      include: {
        location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        variant: { select: { id: true, sku: true, title: true } },
        requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { id: "desc" },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.approveStockAdjustmentRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note;
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prismaClient, ownerUserId);

    const row = await prismaClient.stockAdjustmentRequest.findFirst({
      where: { id, orgId: { in: orgIds } },
      include: { location: true, variant: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.status !== "PENDING") return res.status(400).json({ success: false, message: "Only PENDING can be approved" });

    await ledgerService.recordLedgerEntry({
      locationId: row.locationId,
      variantId: row.variantId,
      lotId: row.lotId ?? undefined,
      type: "ADJUSTMENT",
      quantityDelta: row.quantityDelta,
      refType: "ADJUSTMENT_REQUEST",
      refId: String(row.id),
      createdByUserId: req.user.id,
    });

    const updated = await prismaClient.stockAdjustmentRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedByUserId: req.user.id,
        reviewedAt: new Date(),
        ...(note ? { reviewNote: String(note) } : {}),
      },
      include: { location: true, variant: true },
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.rejectStockAdjustmentRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = req.body?.note;
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prismaClient, ownerUserId);

    const row = await prismaClient.stockAdjustmentRequest.findFirst({
      where: { id, orgId: { in: orgIds } },
    });
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.status !== "PENDING") return res.status(400).json({ success: false, message: "Only PENDING can be rejected" });

    const updated = await prismaClient.stockAdjustmentRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedByUserId: req.user.id,
        reviewedAt: new Date(),
        ...(note ? { reviewNote: String(note) } : {}),
      },
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ------------------------------
// Branch access (owner-only: list / approve / reject)
// GET /api/v1/owner/branch-access?status=PENDING
// POST /api/v1/owner/branch-access/:id/approve
// POST /api/v1/owner/branch-access/:id/reject
// ------------------------------
exports.listBranchAccess = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if (status && !['PENDING', 'APPROVED', 'REVOKED', 'EXPIRED', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status filter' });
    }

    const data = await getBranchAccessListForOwner(ownerUserId, status || undefined);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.approveBranchAccessOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid expiresAt' });
    }

    const permission = await approveBranchAccess(id, ownerUserId, expiresAt);
    notifyStaffOfApproval(permission.userId, permission.branchId).catch((err) => {
      console.error('[owner.controller] notifyStaffOfApproval:', err?.message);
    });
    return res.json({ success: true, data: permission, message: 'Access approved' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to approve' });
  }
};

exports.rejectBranchAccessOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const permission = await revokeBranchAccess(id, ownerUserId, req.body?.note);
    notifyStaffOfRevocation(permission.userId, permission.branchId).catch((err) => {
      console.error('[owner.controller] notifyStaffOfRevocation:', err?.message);
    });
    return res.json({ success: true, data: permission, message: 'Access rejected' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to reject' });
  }
};

function mapStaffAccessRows(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.userId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        user: {
          id: row.user?.id,
          name: row.user?.profile?.displayName || row.user?.auth?.email || row.user?.auth?.phone || "—",
          email: row.user?.auth?.email || null,
          phone: row.user?.auth?.phone || null,
        },
        access: [],
      });
    }
    grouped.get(key).access.push({
      id: row.id,
      branchId: row.branch?.id,
      branchName: row.branch?.name,
      status: row.status,
      role: row.role,
      requestedAt: row.requestedAt,
      approvedAt: row.approvedAt,
      expiresAt: row.expiresAt,
      note: row.note,
    });
  });
  return Array.from(grouped.values());
}

exports.listOwnerStaffAccess = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const rows = await getOwnerStaffAccessRows(ownerUserId);
    return res.json({ success: true, data: mapStaffAccessRows(rows) });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getOwnerStaffBranchAccess = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const staffUserId = Number(req.params.userId);
    if (!staffUserId || !Number.isFinite(staffUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const rows = await getOwnerStaffAccessRowsByUser(ownerUserId, staffUserId);
    return res.json({
      success: true,
      data: rows,
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.assignBranchAccessOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const staffUserId = Number(req.body?.userId);
    const branchId = Number(req.body?.branchId);
    const role = String(req.body?.role || '').toUpperCase();
    const note = req.body?.note ? String(req.body.note) : undefined;
    const expiresAt = req.body?.expiresAt ? parseDateOrNull(req.body.expiresAt) : undefined;

    if (!staffUserId || !branchId || !role) {
      return res.status(400).json({ success: false, message: 'userId, branchId and role are required' });
    }

    const permission = await assignBranchAccessDirect(
      ownerUserId,
      staffUserId,
      branchId,
      role,
      note,
      expiresAt || undefined
    );
    return res.json({ success: true, data: permission, message: 'Access granted' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to assign access' });
  }
};

exports.suspendBranchAccessOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const permission = await suspendBranchAccess(id, ownerUserId, req.body?.note);
    return res.json({ success: true, data: permission, message: 'Access suspended' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to suspend access' });
  }
};

exports.removeBranchAccessOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const permission = await removeBranchAccess(id, ownerUserId, req.body?.note);
    return res.json({ success: true, data: permission, message: 'Access removed' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to remove access' });
  }
};

exports.updateBranchAccessRoleOwner = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = Number(req.params.id);
    const role = req.body?.role;
    if (!id || !role) return res.status(400).json({ success: false, message: 'id and role are required' });

    const permission = await updateBranchAccessRole(id, ownerUserId, String(role).toUpperCase());
    return res.json({ success: true, data: permission, message: 'Role updated' });
  } catch (e) {
    return res.status(400).json({ success: false, message: e?.message || 'Failed to update role' });
  }
};

exports.getBranchAccessRequestDetail = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const permission = await getOwnerBranchAccessRequest(ownerUserId, id);
    if (!permission) return res.status(404).json({ success: false, message: 'Request not found' });
    return res.json({ success: true, data: permission });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ------------------------------
// Owner Staff Invitations (StaffInvite list / approve / reject)
// GET /api/v1/owner/invitations?status=PENDING&branchId=...
// POST /api/v1/owner/invitations/:id/approve
// POST /api/v1/owner/invitations/:id/reject
// ------------------------------
exports.listOwnerInvitations = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if (status && !['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status filter' });
    }
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;

    const where = {
      org: { ownerUserId },
      ...(status ? { status } : {}),
      ...(branchId && Number.isFinite(branchId) ? { branchId } : {}),
    };

    const invitations = await prisma.staffInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true } },
        org: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } } },
      },
    });

    return res.json({ success: true, data: invitations });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.approveOwnerInvitation = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const invite = await prisma.staffInvite.findFirst({
      where: { id, org: { ownerUserId } },
      include: { branch: { select: { name: true } } },
    });
    if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
    if (invite.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Invitation is not pending (${invite.status})` });
    }

    // Approve = leave as PENDING (invitee can still accept). No status change; owner acknowledged.
    return res.json({ success: true, data: invite, message: 'Invitation acknowledged' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.rejectOwnerInvitation = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });

    const invite = await prisma.staffInvite.findFirst({
      where: { id, org: { ownerUserId } },
    });
    if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
    if (invite.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Invitation is not pending (${invite.status})` });
    }

    await prisma.staffInvite.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    return res.json({ success: true, data: { id: invite.id, status: 'REVOKED' }, message: 'Invitation rejected' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listOwnerNotifications = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const prisma = getPrisma(req);
    const type = req.query.type ? String(req.query.type) : undefined;
    const unreadOnly = String(req.query.unread || '') === '1';
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 100));

    const notifications = await prisma.notification.findMany({
      where: {
        userId: ownerUserId,
        ...(type ? { type } : {}),
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return res.json({ success: true, data: notifications });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.markOwnerNotificationRead = async (req, res) => {
  try {
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const prisma = getPrisma(req);

    const existing = await prisma.notification.findFirst({
      where: { id, userId: ownerUserId },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Notification not found' });

    await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * POST /api/v1/owner/branches/:id/members/invite
 * Body: { phone? , email? , displayName?, role }
 * Creates a token-based invite (no temp password in API response). Notifies org owner.
 */
exports.inviteBranchMember = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const { createStaffInvite } = require("../../services/staffInvite.service");

    const { invite, rawToken } = await createStaffInvite(
      prismaClient,
      branchId,
      req.body || {},
      req.user.id,
      "OWNER"
    );

    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    return res.status(201).json({
      success: true,
      data: {
        inviteId: invite.id,
        orgId: invite.orgId,
        branchId: invite.branchId,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        ...(isProd ? {} : { devInviteToken: rawToken }),
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    if (
      e?.message === "role is required" ||
      e?.message === "phone or email is required" ||
      e?.message === "Invalid role for this branch type"
    ) {
      return res.status(400).json({ success: false, message: e.message });
    }
    if (e?.message === "Branch not found") return res.status(404).json({ success: false, message: e.message });
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict" });
    }
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};


// ------------------------------------------------------------
// Bridge endpoints for Owner Web Dashboard (WowDash)
// These endpoints are used by the Next.js owner panel to fetch
// nested branch details and document lists.
// ------------------------------------------------------------

// GET /api/v1/owner/organizations/:orgId/branches/:branchId
exports.getBranchInOrg = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const orgId = asIntId(req.params.orgId);
    const branchId = asIntId(req.params.branchId);
    if (!orgId || !branchId) return res.status(400).json({ success: false, message: 'Invalid orgId/branchId' });

    const org = await ensureOwnerOrg(prisma, ownerUserId, orgId);
    if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, orgId, org: { ownerUserId } },
      include: {
        org: true,
        types: { include: { type: true } },
        profileDetails: {
          include: {
            documents: {
              include: { media: true },
              orderBy: { id: 'desc' },
            },
          },
        },
      },
    });

    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    return res.json({ success: true, data: branch });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// GET (aliases)
// - /api/v1/owner/branches/:id/documents
// - /api/v1/owner/branches/:id/profile/documents
// - /api/v1/owner/branches/:id/profile/list-documents
exports.listBranchDocuments = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const branchId = asIntId(req.params.id);
    if (!branchId) return res.status(400).json({ success: false, message: 'Invalid branch id' });

    const branch = await ensureOwnerBranch(prisma, ownerUserId, branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    // Branch profile details holds the document list
    const profile = await prisma.branchProfileDetails.findUnique({
      where: { branchId },
      include: {
        documents: {
          include: { media: true },
          orderBy: { id: 'desc' },
        },
      },
    }).catch(() => null);

    const docs = profile?.documents || [];
    return res.json({ success: true, data: docs });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// GET /api/v1/owner/verification-documents?entityType=BRANCH&entityId=1
// Legacy dashboard helper: returns the latest verification case documents.
exports.listVerificationDocuments = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = req.query?.entityType ? String(req.query.entityType).trim().toUpperCase() : null;
    const entityId = req.query?.entityId ? asIntId(req.query.entityId) : null;

    if (!entityType || !entityId) {
      return res.status(400).json({ success: false, message: 'entityType and entityId are required' });
    }

    // Access check (same rules as owner.verification.controller)
    if (entityType === 'OWNER') {
      if (entityId !== ownerUserId) return res.status(403).json({ success: false, message: 'Forbidden' });
    } else if (entityType === 'ORGANIZATION') {
      const org = await ensureOwnerOrg(prisma, ownerUserId, entityId);
      if (!org) return res.status(403).json({ success: false, message: 'Forbidden' });
    } else if (entityType === 'BRANCH') {
      const br = await ensureOwnerBranch(prisma, ownerUserId, entityId);
      if (!br) return res.status(403).json({ success: false, message: 'Forbidden' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid entityType' });
    }

    const vc = await prisma.verificationCase.findFirst({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: { documents: { include: { media: true } } },
    }).catch(() => null);

    const docs = vc?.documents || [];
    return res.json({
      success: true,
      data: docs,
      meta: vc ? { caseId: vc.id, status: vc.status } : { caseId: null, status: null },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};


// ------------------------------
// V3 (Owner Panel): Staffs (Branch Members aggregation)
// Staffs in the web dashboard represent BranchMember rows.
// ------------------------------

exports.listStaffs = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id || req.auth?.userId);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';

    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prisma, userId);
    if (!orgIds.length) return res.json({ success: true, data: { items: [], page: 1, limit: 50, total: 0 } });

    const where = {
      orgId: { in: orgIds }
    };

    // NOTE: Prisma string search across nested relations is verbose.
    // We do a lightweight in-memory filter if "search" is present.
    const rows = await prisma.branchMember.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        org: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            status: true,
            auth: { select: { phone: true, email: true } },
            profile: { select: { displayName: true, username: true } }
          }
        }
      }
    });

    const filtered = search
      ? rows.filter(r => {
          const dn = String(r?.user?.profile?.displayName || '').toLowerCase();
          const un = String(r?.user?.profile?.username || '').toLowerCase();
          const ph = String(r?.user?.auth?.phone || '').toLowerCase();
          const em = String(r?.user?.auth?.email || '').toLowerCase();
          const br = String(r?.branch?.name || '').toLowerCase();
          const og = String(r?.org?.name || '').toLowerCase();
          return dn.includes(search) || un.includes(search) || ph.includes(search) || em.includes(search) || br.includes(search) || og.includes(search);
        })
      : rows;

    // Keep response shape stable for tables
    res.json({
      success: true,
      data: {
        items: filtered,
        page: 1,
        limit: filtered.length,
        total: filtered.length
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const row = await prisma.branchMember.findUnique({
      where: { id },
      include: {
        org: { select: { id: true, name: true, ownerUserId: true } },
        branch: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            status: true,
            auth: { select: { phone: true, email: true } },
            profile: { select: { displayName: true, username: true } }
          }
        }
      }
    });

    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    const effectiveOrgIds = await getEffectiveOrgIdsForOwnerPanel(prisma, ownerUserId);
    if (!effectiveOrgIds.length || !effectiveOrgIds.includes(row.orgId)) return res.status(403).json({ success: false, message: 'Forbidden' });

    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    console.log('[updateStaff] Request:', { id, body: req.body });

    const current = await prisma.branchMember.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        branchId: true,
        orgId: true,
        role: true,
        status: true,
        org: { select: { ownerUserId: true } },
        user: {
          select: {
            id: true,
            auth: { select: { id: true, email: true, phone: true } },
            profile: { select: { id: true, displayName: true } }
          }
        }
      }
    });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });
    if (current?.org?.ownerUserId !== ownerUserId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const data: Record<string, any> = {};

    if (req.body?.role !== undefined) {
      data.role = String(req.body.role).trim().toUpperCase();
    }

    if (req.body?.status !== undefined) {
      data.status = String(req.body.status).trim().toUpperCase();
    }

    if (req.body?.branchId !== undefined && req.body.branchId !== null && req.body.branchId !== "") {
      const newBranchId = Number(req.body.branchId);
      if (!isNaN(newBranchId) && newBranchId > 0 && newBranchId !== current.branchId) {
        // Verify new branch belongs to owner
        const newBranch = await prisma.branch.findUnique({
          where: { id: newBranchId },
          include: { org: { select: { ownerUserId: true, id: true } } }
        });
        if (!newBranch) return res.status(404).json({ success: false, message: 'Branch not found' });
        if (newBranch.org.ownerUserId !== ownerUserId) {
          return res.status(403).json({ success: false, message: 'Forbidden: Branch does not belong to you' });
        }
        // Check if user is already a member of the new branch
        const existingInNewBranch = await prisma.branchMember.findUnique({
          where: { branchId_userId: { branchId: newBranchId, userId: current.userId } }
        });
        if (existingInNewBranch) {
          return res.status(409).json({ success: false, message: 'User is already a member of this branch' });
        }
        data.branchId = newBranchId;
        data.orgId = newBranch.org.id;
      }
    }

    const updated = await prisma.branchMember.update({ where: { id }, data });

    // Update user profile/auth if provided
    if (current.user) {
      const userUpdates: any[] = [];

      if (req.body?.displayName !== undefined && req.body.displayName !== null && String(req.body.displayName).trim()) {
        const displayName = String(req.body.displayName).trim();
        if (current.user.profile) {
          userUpdates.push(
            prisma.userProfile.update({
              where: { userId: current.user.id },
              data: { displayName }
            })
          );
        } else {
          userUpdates.push(
            prisma.userProfile.create({
              data: { userId: current.user.id, displayName }
            })
          );
        }
      }

      if (req.body?.email !== undefined && req.body.email !== null && String(req.body.email).trim() && current.user.auth) {
        const emailNorm = String(req.body.email).trim().toLowerCase();
        const currentEmail = current.user.auth.email ? String(current.user.auth.email).trim().toLowerCase() : null;
        // Only update if email is different from current
        if (emailNorm !== currentEmail) {
          const existingEmail = await prisma.userAuth.findFirst({
            where: {
              email: emailNorm,
              id: { not: current.user.auth.id }
            }
          });
          if (existingEmail) {
            return res.status(409).json({ success: false, message: 'Email already exists for another user' });
          }

          // Only add update if email is actually different
          userUpdates.push(
            prisma.userAuth.update({
              where: { id: current.user.auth.id },
              data: { email: emailNorm }
            })
          );
        }
        // If email is same as current, skip update (no need to update with same value)
      }

      if (req.body?.phone !== undefined && req.body.phone !== null && String(req.body.phone).trim() && current.user.auth) {
        // Normalize phone: remove all non-digit characters
        const phoneNorm = String(req.body.phone).trim().replace(/\D/g, "");
        if (phoneNorm && phoneNorm.length > 0) {
          const currentPhone = current.user.auth.phone ? String(current.user.auth.phone).trim().replace(/\D/g, "") : null;

          // Only update if phone is different from current (normalized)
          if (phoneNorm !== currentPhone) {
            console.log('[updateStaff] Checking phone uniqueness:', { phoneNorm, currentPhone, authId: current.user.auth.id });

            // Check for exact match first (fast path)
            const existingPhoneExact = await prisma.userAuth.findFirst({
              where: {
                phone: phoneNorm,
                id: { not: current.user.auth.id }
              }
            });
            if (existingPhoneExact) {
              console.log('[updateStaff] Phone conflict found (exact match):', existingPhoneExact.id);
              return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
            }

            // Also check for normalized matches (in case phone is stored in different format)
            // This handles cases where phone might be stored as "017 1234 5678" vs "01712345678"
            // Only check if phoneNorm is at least 10 digits (valid phone number)
            if (phoneNorm.length >= 10) {
              const allUserAuths = await prisma.userAuth.findMany({
                where: {
                  phone: { not: null },
                  id: { not: current.user.auth.id }
                },
                select: { id: true, phone: true }
              });

              for (const auth of allUserAuths) {
                if (auth.phone) {
                  const normalizedExisting = String(auth.phone).trim().replace(/\D/g, "");
                  // Compare normalized versions
                  if (normalizedExisting === phoneNorm) {
                    console.log('[updateStaff] Phone conflict found (normalized match):', { existingId: auth.id, existingPhone: auth.phone, normalized: normalizedExisting });
                    return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
                  }
                }
              }
            }

            // Final safety check right before adding the update
            // Double-check that this phone doesn't exist for another user (exact match)
            const finalCheck = await prisma.userAuth.findFirst({
              where: {
                phone: phoneNorm,
                id: { not: current.user.auth.id }
              }
            });

            if (finalCheck) {
              console.log('[updateStaff] Final check found phone conflict (exact):', finalCheck.id);
              return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
            }

            // Also do a final normalized check to catch any edge cases
            const allFinalCheck = await prisma.userAuth.findMany({
              where: {
                phone: { not: null },
                id: { not: current.user.auth.id }
              },
              select: { id: true, phone: true }
            });

            for (const auth of allFinalCheck) {
              if (auth.phone) {
                const normalizedExisting = String(auth.phone).trim().replace(/\D/g, "");
                if (normalizedExisting === phoneNorm) {
                  console.log('[updateStaff] Final check found phone conflict (normalized):', { existingId: auth.id, existingPhone: auth.phone });
                  return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
                }
              }
            }

            console.log('[updateStaff] Phone validation passed, adding update');
            // Only add update if phone is actually different and validation passed
            userUpdates.push(
              prisma.userAuth.update({
                where: { id: current.user.auth.id },
                data: { phone: phoneNorm }
              })
            );
          } else {
            console.log('[updateStaff] Phone unchanged, skipping update');
          }
        }
      }

      if (userUpdates.length > 0) {
        // Execute updates one by one to catch specific errors
        for (const updatePromise of userUpdates) {
          try {
            await updatePromise;
          } catch (updateError) {
            console.error('[updateStaff] User update error:', updateError);
            // Handle unique constraint violations
            if (String(updateError?.code) === "P2002") {
              const target = updateError?.meta?.target || [];
              const modelName = updateError?.meta?.modelName || '';
              console.error('[updateStaff] Unique constraint violation:', { target, modelName });

              if (target.includes('email') || (modelName === 'UserAuth' && target.includes('email'))) {
                return res.status(409).json({ success: false, message: 'Email already exists for another user' });
              }
              if (target.includes('phone') || (modelName === 'UserAuth' && target.includes('phone'))) {
                return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
              }
              return res.status(409).json({ success: false, message: 'A unique constraint violation occurred. The email or phone number may already be in use.' });
            }
            throw updateError; // Re-throw if not a unique constraint error
          }
        }
      }
    }

    // Fetch updated member with relations
    const updatedWithRelations = await prisma.branchMember.findUnique({
      where: { id },
      include: {
        org: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            status: true,
            auth: { select: { phone: true, email: true } },
            profile: { select: { displayName: true, username: true } }
          }
        }
      }
    });

    await writeAudit({
      prisma,
      req,
      action: 'BRANCH_MEMBER_UPDATE',
      entityType: 'BRANCH', // Use BRANCH since BRANCH_MEMBER is not in AuditEntityType enum
      entityId: id,
      before: current,
      after: updated
    });

    res.json({ success: true, data: updatedWithRelations });
  } catch (e) {
    console.error("updateStaff error:", e);

    // Handle Prisma unique constraint violations
    if (String(e?.code) === "P2002") {
      const target = e?.meta?.target || [];
      if (target.includes('email')) {
        return res.status(409).json({ success: false, message: 'Email already exists for another user' });
      }
      if (target.includes('phone')) {
        return res.status(409).json({ success: false, message: 'Phone number already exists for another user' });
      }
      return res.status(409).json({ success: false, message: 'A unique constraint violation occurred' });
    }

    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.disableStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const current = await prisma.branchMember.findUnique({
      where: { id },
      include: { org: { select: { ownerUserId: true } } }
    });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });
    if (current?.org?.ownerUserId !== ownerUserId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: 'DISABLED' }
    });

    await writeAudit({
      prisma,
      req,
      action: 'BRANCH_MEMBER_DISABLE',
      entityType: 'BRANCH', // Use BRANCH since BRANCH_MEMBER is not in AuditEntityType enum
      entityId: id,
      before: current,
      after: updated
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.enableStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const current = await prisma.branchMember.findUnique({
      where: { id },
      include: { org: { select: { ownerUserId: true } } }
    });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });
    if (current?.org?.ownerUserId !== ownerUserId) return res.status(403).json({ success: false, message: 'Forbidden' });

    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: 'ACTIVE' }
    });

    await writeAudit({
      prisma,
      req,
      action: 'BRANCH_MEMBER_ENABLE',
      entityType: 'BRANCH',
      entityId: id,
      before: current,
      after: updated
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const current = await prisma.branchMember.findUnique({
      where: { id },
      include: { org: { select: { ownerUserId: true } } }
    });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });
    if (current?.org?.ownerUserId !== ownerUserId) return res.status(403).json({ success: false, message: 'Forbidden' });

    await prisma.branchMember.delete({ where: { id } });

    await writeAudit({
      prisma,
      req,
      action: 'BRANCH_MEMBER_DELETE',
      entityType: 'BRANCH', // Use BRANCH since BRANCH_MEMBER is not in AuditEntityType enum
      entityId: id,
      before: current,
      after: null
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.createStaff = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { email, phone, displayName, role, branchId } = req.body || {};

    console.log('[createStaff] Request body:', { email, phone, displayName, role, branchId });

    if (!role) return res.status(400).json({ success: false, message: 'role is required' });

    // Validate role against MemberRole enum
    const validRoles = ['OWNER', 'ORG_ADMIN', 'BRANCH_MANAGER', 'BRANCH_STAFF', 'SELLER', 'DELIVERY_MANAGER', 'DELIVERY_STAFF'];
    const roleUpper = String(role).trim().toUpperCase();
    if (!validRoles.includes(roleUpper)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    const emailNorm = (email || "").trim().toLowerCase() || null;
    const phoneNorm = (phone || "").trim().replace(/\D/g, "") || null;

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: 'phone or email is required' });
    }

    // Determine branch and org
    let branch = null;
    let orgId = null;
    let finalBranchId = null;

    // Handle branchId - can be number, string, or undefined/empty
    const branchIdNum = branchId !== undefined && branchId !== null && branchId !== "" ? Number(branchId) : null;

    if (branchIdNum && !isNaN(branchIdNum) && branchIdNum > 0) {
      branch = await prisma.branch.findUnique({
        where: { id: branchIdNum },
        include: { org: { select: { id: true, ownerUserId: true, name: true } } }
      });
      if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
      if (branch.org.ownerUserId !== ownerUserId) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      orgId = branch.org.id;
      finalBranchId = branch.id;
    } else {
      // If no branchId, find first branch of owner's first org
      const org = await prisma.organization.findFirst({
        where: { ownerUserId },
        include: {
          branches: {
            take: 1,
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, orgId: true }
          }
        }
      });
      if (!org) {
        return res.status(400).json({ success: false, message: 'No organization found. Please create an organization first.' });
      }
      if (!org.branches || org.branches.length === 0) {
        return res.status(400).json({ success: false, message: 'No branches found. Please create a branch first or specify branchId.' });
      }
      branch = { ...org.branches[0], org: { id: org.id, ownerUserId, name: org.name || null } };
      orgId = org.id;
      finalBranchId = branch.id;
    }

    // Try to find existing user by email or phone
    let user = null;
    if (emailNorm) {
      const auth = await prisma.userAuth.findFirst({
        where: { email: emailNorm },
        include: { user: true }
      });
      if (auth) user = auth.user;
    }
    if (!user && phoneNorm) {
      const auth = await prisma.userAuth.findFirst({
        where: { phone: phoneNorm },
        include: { user: true }
      });
      if (auth) user = auth.user;
    }

    if (user) {
      // User exists - create BranchMember directly
      // Check if already a member
      const existing = await prisma.branchMember.findUnique({
        where: { branchId_userId: { branchId: finalBranchId, userId: user.id } }
      });
      if (existing) {
        return res.status(409).json({ success: false, message: 'User is already a member of this branch' });
      }

      const member = await prisma.branchMember.create({
        data: {
          orgId,
          branchId: finalBranchId,
          userId: user.id,
          role: roleUpper,
          status: 'ACTIVE',
          invitedByUserId: ownerUserId
        },
        include: {
          org: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          user: {
            select: {
              id: true,
              status: true,
              auth: { select: { phone: true, email: true } },
              profile: { select: { displayName: true, username: true } }
            }
          }
        }
      });

      // Update user profile if displayName provided
      if (displayName) {
        await prisma.userProfile.upsert({
          where: { userId: user.id },
          update: { displayName: String(displayName).trim() },
          create: { userId: user.id, displayName: String(displayName).trim() }
        });
      }

      await writeAudit({
        prisma,
        req,
        action: 'BRANCH_MEMBER_CREATE',
        entityType: 'BRANCH', // Use BRANCH since BRANCH_MEMBER is not in AuditEntityType enum
        entityId: member.id,
        before: null,
        after: member
      });

      return res.status(201).json({ success: true, data: member });
    } else {
      // User doesn't exist - create StaffInvite

      const crypto = require("crypto");
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

      const invite = await prisma.staffInvite.create({
        data: {
          orgId,
          branchId: finalBranchId,
          role: roleUpper,
          status: "PENDING",
          email: emailNorm,
          phone: phoneNorm,
          displayName: displayName ? String(displayName).trim() : null,
          tokenHash,
          expiresAt,
          invitedByUserId: ownerUserId,
        },
      });

      // Send invite notification
      try {
        const { sendInvite } = require("../../../../utils/inviteNotifier");
        const channel = phoneNorm ? "SMS" : "EMAIL";
        const to = phoneNorm ? phoneNorm : emailNorm;

        const base = String(process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
        const link = `${base}/register?invite=${rawToken}`;
        const msg = `BPA Invite: You are invited as ${role} for branch "${branch.name}". Complete registration: ${link}`;

        let emailPayload = undefined;
        if (channel === "EMAIL") {
          const { renderInviteEmail } = require("../../../../utils/emailTemplates/inviteEmail");
          const rendered = renderInviteEmail({
            toName: displayName || null,
            role: String(role),
            branchName: branch?.name || null,
            orgName: null,
            inviteLink: link,
            expiresAt,
          });
          emailPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text };
        }

        await sendInvite({ channel, to, message: msg, email: emailPayload });
      } catch (notifyError) {
        console.error("Failed to send invite notification:", notifyError);
        // Continue even if notification fails
      }

      const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

      return res.status(201).json({
        success: true,
        data: {
          inviteId: invite.id,
          orgId: invite.orgId,
          branchId: invite.branchId,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          ...(isProd ? {} : { devInviteToken: rawToken }),
        },
      });
    }
  } catch (e) {
    console.error("createStaff error:", e);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    // Handle Prisma unique constraint violations
    if (String(e?.code) === "P2002") {
      const target = e?.meta?.target || [];
      if (target.includes('branchId') && target.includes('userId')) {
        return res.status(409).json({ success: false, message: "User is already a member of this branch" });
      }
      return res.status(409).json({ success: false, message: "User is already a member" });
    }

    // Handle Prisma validation errors
    if (e?.code === "P2003" || e?.code === "P2025") {
      return res.status(400).json({
        success: false,
        message: isProd ? "Invalid data provided" : (e?.message || "Invalid data provided")
      });
    }

    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

// ============================================
/**
 * GET /api/v1/owner/hubs
 * List ONLINE_HUB InventoryLocations within effective org/branch scope (for order hub filter).
 */
exports.getHubs = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const userId = asIntId(req.user?.id || req.auth?.userId);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const branchIds = await getEffectiveBranchIdsForOwnerPanel(prisma, userId);
    if (branchIds.length === 0) return res.json({ success: true, data: [] });

    const hubs = await prisma.inventoryLocation.findMany({
      where: { branchId: { in: branchIds }, type: 'ONLINE_HUB', isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
    });

    return res.json({ success: true, data: hubs });
  } catch (e) {
    console.error('getHubs error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// Dashboard Endpoints
// ============================================

/**
 * GET /api/v1/owner/dashboard/metrics
 * Get key metrics for owner dashboard
 */
exports.getDashboardMetrics = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Get all branches
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true, status: true, verificationStatus: true },
    });
    const branchIds = branches.map((b) => b.id);

    // Get staff count
    const staffCount = await prisma.branchMember.count({
      where: { branchId: { in: branchIds }, status: 'ACTIVE' },
    });

    // Get today's date range
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Revenue calculations (from orders)
    const [todayRevenue, weekRevenue, monthRevenue, yearRevenue] = await Promise.all([
      prisma.order.aggregate({
        where: {
          branchId: { in: branchIds },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          createdAt: { gte: todayStart },
        },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          branchId: { in: branchIds },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          createdAt: { gte: weekStart },
        },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          branchId: { in: branchIds },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          createdAt: { gte: monthStart },
        },
        _sum: { totalAmount: true },
      }),
      prisma.order.aggregate({
        where: {
          branchId: { in: branchIds },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          createdAt: { gte: yearStart },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    // Order counts
    const [todayOrders, pendingOrders, completedOrders, totalOrders] = await Promise.all([
      prisma.order.count({
        where: { branchId: { in: branchIds }, createdAt: { gte: todayStart } },
      }),
      prisma.order.count({
        where: { branchId: { in: branchIds }, status: 'PENDING' },
      }),
      prisma.order.count({
        where: { branchId: { in: branchIds }, status: 'DELIVERED' },
      }),
      prisma.order.count({
        where: { branchId: { in: branchIds } },
      }),
    ]);

    // Product counts
    const [totalProducts, activeProducts] = await Promise.all([
      prisma.product.count({
        where: { orgId: { in: orgIds } },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, status: 'ACTIVE' },
      }),
    ]);

    // Low stock and out of stock (from inventory)
    let lowStockCount = 0;
    let outOfStockCount = 0;
    try {
      const lowStock = await prisma.inventoryLedger.findMany({
        where: {
          branchId: { in: branchIds },
        },
        select: { quantity: true, minStock: true },
      });
      lowStockCount = lowStock.filter((item) => Number(item.quantity || 0) <= Number(item.minStock || 0)).length;
      outOfStockCount = lowStock.filter((item) => Number(item.quantity || 0) <= 0).length;
    } catch (e) {
      // Inventory might not exist yet
    }

    // Wallet balance (if wallet module exists)
    let walletBalance = { available: 0, pending: 0, total: 0 };
    try {
      const wallet = await prisma.wallet.findFirst({
        where: { userId: ownerUserId },
        select: { balance: true, pendingBalance: true },
      });
      if (wallet) {
        walletBalance = {
          available: Number(wallet.balance || 0),
          pending: Number(wallet.pendingBalance || 0),
          total: Number(wallet.balance || 0) + Number(wallet.pendingBalance || 0),
        };
      }
    } catch (e) {
      // Wallet table might not exist, ignore
    }

    res.json({
      success: true,
      data: {
        revenue: {
          today: Number(todayRevenue._sum.totalAmount || 0),
          week: Number(weekRevenue._sum.totalAmount || 0),
          month: Number(monthRevenue._sum.totalAmount || 0),
          year: Number(yearRevenue._sum.totalAmount || 0),
        },
        orders: {
          today: todayOrders,
          pending: pendingOrders,
          completed: completedOrders,
          total: totalOrders,
        },
        products: {
          total: totalProducts,
          active: activeProducts,
          lowStock: lowStockCount,
          outOfStock: outOfStockCount,
        },
        branches: {
          total: branches.length,
          active: branches.filter((b) => b.status === 'ACTIVE').length,
          inactive: branches.filter((b) => b.status === 'INACTIVE').length,
          pending: branches.filter((b) => b.verificationStatus === 'SUBMITTED' || b.verificationStatus === 'DRAFT').length,
        },
        staff: {
          total: staffCount,
          active: staffCount,
          inactive: 0,
        },
        wallet: walletBalance,
      },
    });
  } catch (e) {
    console.error('getDashboardMetrics error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/dashboard/revenue
 * Get revenue chart data
 */
exports.getDashboardRevenue = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const period = req.query.period || '30d';
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    const branchIds = branches.map((b) => b.id);

    const now = new Date();
    let startDate;
    if (period === '7d') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    } else if (period === '6m') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 6);
    } else if (period === '1y') {
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
    } else {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get orders grouped by date
    const orders = await prisma.order.findMany({
      where: {
        branchId: { in: branchIds },
        status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
        createdAt: { gte: startDate },
      },
      select: {
        totalAmount: true,
        createdAt: true,
      },
    });

    // Group by date
    const revenueByDate = {};
    orders.forEach((order) => {
      const dateKey = order.createdAt.toISOString().split('T')[0];
      if (!revenueByDate[dateKey]) {
        revenueByDate[dateKey] = 0;
      }
      revenueByDate[dateKey] += Number(order.totalAmount || 0);
    });

    // Convert to array format
    const labels = Object.keys(revenueByDate).sort();
    const data = labels.map((label) => revenueByDate[label]);
    const total = data.reduce((sum, val) => sum + val, 0);

    res.json({
      success: true,
      data: {
        labels,
        data,
        total,
      },
    });
  } catch (e) {
    console.error('getDashboardRevenue error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/dashboard/sales-by-branch
 * Get sales data by branch
 */
exports.getDashboardSalesByBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const period = req.query.period || '30d';
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      include: {
        branches: {
          select: { id: true, name: true },
        },
      },
    });

    const now = new Date();
    let startDate;
    if (period === '30d') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    } else {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    }

    const branchSales = await Promise.all(
      orgs.flatMap((org) =>
        org.branches.map(async (branch) => {
          const sales = await prisma.order.aggregate({
            where: {
              branchId: branch.id,
              status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
              createdAt: { gte: startDate },
            },
            _sum: { totalAmount: true },
          });
          return {
            id: branch.id,
            name: branch.name,
            sales: Number(sales._sum.totalAmount || 0),
          };
        })
      )
    );

    const totalSales = branchSales.reduce((sum, b) => sum + b.sales, 0);
    const branches = branchSales.map((b) => ({
      ...b,
      percentage: totalSales > 0 ? ((b.sales / totalSales) * 100).toFixed(1) : 0,
    }));

    res.json({
      success: true,
      data: { branches },
    });
  } catch (e) {
    console.error('getDashboardSalesByBranch error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/dashboard/top-products
 * Get top selling products
 */
exports.getDashboardTopProducts = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const limit = parseInt(req.query.limit) || 10;
    const period = req.query.period || '30d';

    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    const branchIds = branches.map((b) => b.id);

    const now = new Date();
    let startDate;
    if (period === '30d') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    } else {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get order items grouped by product
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          branchId: { in: branchIds },
          status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
          createdAt: { gte: startDate },
        },
      },
      include: {
        product: {
          select: { id: true, name: true },
        },
      },
    });

    // Aggregate by product
    interface ProductStats {
      id: number;
      name: string;
      category: string | null;
      quantity: number;
      revenue: number;
    }

    const productMap: Record<number, ProductStats> = {};
    orderItems.forEach((item) => {
      const productId = item.productId;
      if (!productMap[productId]) {
        productMap[productId] = {
          id: productId,
          name: item.product?.name || 'Unknown',
          category: null,
          quantity: 0,
          revenue: 0,
        };
      }
      productMap[productId].quantity += item.quantity || 0;
      productMap[productId].revenue += Number(item.total || item.price || 0) * (item.quantity || 0);
    });

    const products = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    res.json({
      success: true,
      data: { products },
    });
  } catch (e) {
    console.error('getDashboardTopProducts error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/dashboard/recent-activity
 * Get recent activity feed
 */
exports.getDashboardRecentActivity = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const limit = parseInt(req.query.limit) || 20;

    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    const branchIds = branches.map((b) => b.id);

    // Get recent orders
    const recentOrders = await prisma.order.findMany({
      where: { branchId: { in: branchIds } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        status: true,
        createdAt: true,
      },
    });

    const activities = recentOrders.map((order) => ({
      type: 'order',
      title: `New order #${order.orderNumber}`,
      description: `Order amount: ৳${Number(order.totalAmount || 0).toLocaleString('en-BD')}`,
      timestamp: order.createdAt,
      link: `/owner/orders/${order.id}`,
    }));

    res.json({
      success: true,
      data: { activities: activities.slice(0, limit) },
    });
  } catch (e) {
    console.error('getDashboardRecentActivity error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/dashboard/alerts
 * Get attention required items
 */
exports.getDashboardAlerts = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true, name: true },
    });
    const orgIds = orgs.map((o) => o.id);
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true, name: true, orgId: true },
    });
    const branchIds = branches.map((b) => b.id);

    // Pending verifications
    const verifications = [];
    for (const org of orgs) {
      const vc = await prisma.verificationCase.findFirst({
        where: { entityType: 'ORGANIZATION', entityId: org.id, status: { in: ['SUBMITTED', 'REJECTED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (vc) {
        verifications.push({
          id: vc.id,
          name: org.name,
          type: 'ORGANIZATION',
          status: vc.status,
        });
      }
    }
    for (const branch of branches) {
      const vc = await prisma.verificationCase.findFirst({
        where: { entityType: 'BRANCH', entityId: branch.id, status: { in: ['SUBMITTED', 'REJECTED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (vc) {
        verifications.push({
          id: vc.id,
          name: branch.name,
          type: 'BRANCH',
          status: vc.status,
        });
      }
    }

    // Low stock items
    let lowStock = [];
    try {
      const lowStockItems = await prisma.inventoryLedger.findMany({
        where: {
          branchId: { in: branchIds },
        },
        include: {
          product: {
            select: { id: true, name: true },
          },
        },
        take: 10,
      });
      lowStock = lowStockItems
        .filter((item) => Number(item.quantity || 0) <= Number(item.minStock || 0))
        .map((item) => ({
          id: item.productId,
          name: item.product?.name || 'Unknown',
          productName: item.product?.name || 'Unknown',
          stock: Number(item.quantity || 0),
        }));
    } catch (e) {
      // Inventory might not exist
    }

    // Pending orders
    const pendingOrders = await prisma.order.findMany({
      where: {
        branchId: { in: branchIds },
        status: 'PENDING',
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
      },
      take: 10,
    });

    // Rejected documents
    const rejectedDocs = [];
    for (const org of orgs) {
      const vc = await prisma.verificationCase.findFirst({
        where: { entityType: 'ORGANIZATION', entityId: org.id },
        include: { documents: true },
        orderBy: { createdAt: 'desc' },
      });
      if (vc) {
        const rejected = vc.documents.filter((d) => d.status === 'REJECTED');
        rejected.forEach((doc) => {
          rejectedDocs.push({
            id: doc.id,
            entityName: org.name,
            documentType: doc.documentType || 'Document',
          });
        });
      }
    }
    for (const branch of branches) {
      const vc = await prisma.verificationCase.findFirst({
        where: { entityType: 'BRANCH', entityId: branch.id },
        include: { documents: true },
        orderBy: { createdAt: 'desc' },
      });
      if (vc) {
        const rejected = vc.documents.filter((d) => d.status === 'REJECTED');
        rejected.forEach((doc) => {
          rejectedDocs.push({
            id: doc.id,
            entityName: branch.name,
            documentType: doc.documentType || 'Document',
          });
        });
      }
    }

    res.json({
      success: true,
      data: {
        verifications,
        lowStock,
        pendingOrders,
        rejectedDocs: rejectedDocs.slice(0, 10),
      },
    });
  } catch (e) {
    console.error('getDashboardAlerts error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/products/summary
 * Get product summary for owner dashboard
 */
exports.getProductsSummary = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Get all branches
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: orgIds } },
      select: { id: true },
    });
    const branchIds = branches.map((b) => b.id);

    // Product counts by status
    const [totalProducts, activeProducts, inactiveProducts] = await Promise.all([
      prisma.product.count({
        where: { orgId: { in: orgIds } },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, status: 'ACTIVE' },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, status: 'INACTIVE' },
      }),
    ]);

    // Product counts by approval status
    const [draftProducts, pendingApprovalProducts, approvedProducts, publishedProducts] = await Promise.all([
      prisma.product.count({
        where: { orgId: { in: orgIds }, approvalStatus: 'DRAFT' },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, approvalStatus: 'PENDING_APPROVAL' },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, approvalStatus: 'APPROVED' },
      }),
      prisma.product.count({
        where: { orgId: { in: orgIds }, approvalStatus: 'PUBLISHED' },
      }),
    ]);

    // Recent products (last 10)
    const recentProducts = await prisma.product.findMany({
      where: { orgId: { in: orgIds } },
      select: {
        id: true,
        name: true,
        status: true,
        approvalStatus: true,
        createdAt: true,
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Products by category
    const productsByCategory = await prisma.product.groupBy({
      by: ['categoryId'],
      where: { orgId: { in: orgIds } },
      _count: { id: true },
    });

    // Get category names
    const categoryIds = productsByCategory.map((p) => p.categoryId).filter(Boolean) as number[];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const categoryBreakdown = productsByCategory.map((p) => {
      const category = p.categoryId ? (categoryMap.get(p.categoryId) as { id: number; name: string } | undefined) : null;
      return {
        categoryId: p.categoryId,
        categoryName: category?.name || 'Uncategorized',
        count: p._count.id,
      };
    });

    // Low stock alerts across all branches
    let lowStockAlerts = [];
    let outOfStockAlerts = [];
    try {
      const inventoryItems = await prisma.inventory.findMany({
        where: { branchId: { in: branchIds } },
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, title: true, sku: true } },
          branch: { select: { id: true, name: true } },
        },
      });

      lowStockAlerts = inventoryItems
        .filter((item) => item.quantity > 0 && item.quantity <= item.minStock)
        .map((item) => ({
          productId: item.productId,
          productName: item.product?.name || 'Unknown',
          variantId: item.variantId,
          variantTitle: item.variant?.title || 'Standard',
          branchId: item.branchId,
          branchName: item.branch?.name || 'Unknown',
          quantity: item.quantity,
          minStock: item.minStock,
        }))
        .slice(0, 20);

      outOfStockAlerts = inventoryItems
        .filter((item) => item.quantity === 0)
        .map((item) => ({
          productId: item.productId,
          productName: item.product?.name || 'Unknown',
          variantId: item.variantId,
          variantTitle: item.variant?.title || 'Standard',
          branchId: item.branchId,
          branchName: item.branch?.name || 'Unknown',
        }))
        .slice(0, 20);
    } catch (e) {
      // Inventory might not exist
    }

    res.json({
      success: true,
      data: {
        summary: {
          total: totalProducts,
          active: activeProducts,
          inactive: inactiveProducts,
        },
        approvalStatus: {
          draft: draftProducts,
          pendingApproval: pendingApprovalProducts,
          approved: approvedProducts,
          published: publishedProducts,
        },
        recentProducts,
        categoryBreakdown,
        lowStockAlerts,
        outOfStockAlerts,
      },
    });
  } catch (e) {
    console.error('getProductsSummary error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/products/branch-availability
 * Get product availability across branches
 */
exports.getProductBranchAvailability = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const productId = parseInt(req.query.productId);
    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required' });
    }

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Verify product belongs to owner's organization
    const product = await prisma.product.findFirst({
      where: { id: productId, orgId: { in: orgIds } },
      select: { id: true, name: true, orgId: true },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Get all branches for this organization
    const branches = await prisma.branch.findMany({
      where: { orgId: product.orgId },
      select: { id: true, name: true, status: true },
    });

    // Get inventory for this product across all branches
    const inventoryItems = await prisma.inventory.findMany({
      where: {
        productId: productId,
        branchId: { in: branches.map((b) => b.id) },
      },
      include: {
        variant: { select: { id: true, title: true, sku: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    // Group by branch
    const branchAvailability = branches.map((branch) => {
      const branchInventory = inventoryItems.filter((inv) => inv.branchId === branch.id);
      const totalQuantity = branchInventory.reduce((sum, inv) => sum + inv.quantity, 0);
      const variants = branchInventory.map((inv) => ({
        variantId: inv.variantId,
        variantTitle: inv.variant?.title || 'Standard',
        sku: inv.variant?.sku || 'N/A',
        quantity: inv.quantity,
        minStock: inv.minStock,
        status: inv.quantity === 0 ? 'out_of_stock' : inv.quantity <= inv.minStock ? 'low_stock' : 'in_stock',
      }));

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchStatus: branch.status,
        hasInventory: branchInventory.length > 0,
        totalQuantity,
        variants,
      };
    });

    res.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.name,
        },
        branchAvailability,
      },
    });
  } catch (e) {
    console.error('getProductBranchAvailability error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * POST /api/v1/owner/products/:id/add-to-branches
 * Add product to multiple branches with inventory
 */
exports.addProductToBranches = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const productId = parseInt(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const { branchIds, initialQuantity, minStock } = req.body;

    if (!branchIds || !Array.isArray(branchIds) || branchIds.length === 0) {
      return res.status(400).json({ success: false, message: 'branchIds array is required' });
    }

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Verify product belongs to owner's organization
    const product = await prisma.product.findFirst({
      where: { id: productId, orgId: { in: orgIds } },
      select: { id: true, name: true, orgId: true },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Verify branches belong to the same organization
    const branches = await prisma.branch.findMany({
      where: {
        id: { in: branchIds.map((id) => parseInt(id)) },
        orgId: product.orgId,
      },
      select: { id: true, name: true },
    });

    if (branches.length !== branchIds.length) {
      return res.status(400).json({ success: false, message: 'Some branches not found or do not belong to your organization' });
    }

    // Get product variants (use first variant if multiple, or create for product without variant)
    const variants = await prisma.productVariant.findMany({
      where: { productId, isActive: true },
      select: { id: true },
    });

    const createdInventories = [];

    // Create inventory entries for each branch
    for (const branchId of branchIds) {
      const branchIdNum = parseInt(branchId);

      if (variants.length > 0) {
        // Create inventory for each variant
        for (const variant of variants) {
          // Check if inventory already exists
          const existing = await prisma.inventory.findFirst({
            where: {
              branchId: branchIdNum,
              productId: productId,
              variantId: variant.id,
            },
          });

          if (!existing) {
            const inventory = await prisma.inventory.create({
              data: {
                branchId: branchIdNum,
                productId: productId,
                variantId: variant.id,
                quantity: initialQuantity || 0,
                minStock: minStock || 10,
              },
            });
            createdInventories.push(inventory);
          }
        }
      } else {
        // Create inventory for product without variant
        const existing = await prisma.inventory.findFirst({
          where: {
            branchId: branchIdNum,
            productId: productId,
            variantId: null,
          },
        });

        if (!existing) {
          const inventory = await prisma.inventory.create({
            data: {
              branchId: branchIdNum,
              productId: productId,
              variantId: null,
              quantity: initialQuantity || 0,
              minStock: minStock || 10,
            },
          });
          createdInventories.push(inventory);
        }
      }
    }

    res.json({
      success: true,
      data: {
        productId,
        branchesAdded: branches.length,
        inventoriesCreated: createdInventories.length,
        inventories: createdInventories,
      },
      message: `Product added to ${branches.length} branch(es)`,
    });
  } catch (e) {
    console.error('addProductToBranches error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

/**
 * GET /api/v1/owner/branches/:id/products-with-inventory
 * Get products with inventory for a specific branch
 */
exports.getBranchProductsWithInventory = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const branchId = parseInt(req.params.id);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Invalid branch ID' });
    }

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Verify branch belongs to owner's organization
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, orgId: { in: orgIds } },
      select: { id: true, name: true, orgId: true },
    });

    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    // Get all products for this organization
    let products = [];
    try {
      products = await prisma.product.findMany({
        where: { orgId: branch.orgId },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          approvalStatus: true,
          category: {
            select: { name: true }
          },
          brand: {
            select: { name: true }
          },
          variants: {
            where: { isActive: true },
            select: { id: true, sku: true, title: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (productError) {
      console.error('Error fetching products:', productError);
      // Return empty products array
      products = [];
    }

    // Get inventory for this branch
    let inventoryItems = [];
    try {
      inventoryItems = await prisma.inventory.findMany({
        where: { branchId: branchId },
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          minStock: true,
          variant: {
            select: { id: true, title: true, sku: true },
          },
        },
      });
    } catch (invError) {
      console.error('Error fetching inventory:', invError);
      // Continue with empty inventory array
      inventoryItems = [];
    }

    // Create a map of product/variant to inventory
    const inventoryMap = new Map();
    if (inventoryItems && Array.isArray(inventoryItems)) {
      inventoryItems.forEach((inv) => {
        if (inv && inv.productId) {
          const key = `${inv.productId}-${inv.variantId || 'null'}`;
          inventoryMap.set(key, inv);
        }
      });
    }

    // Combine products with inventory data
    const productsWithInventory = (products || []).map((product) => {
      const variants = product.variants || [];
      if (variants.length > 0) {
        // Product with variants
        const variantsWithInventory = variants.map((variant) => {
          const key = `${product.id}-${variant.id}`;
          const inventory = inventoryMap.get(key);
          return {
            variantId: variant.id,
            sku: variant.sku,
            title: variant.title,
            hasInventory: !!inventory,
            quantity: inventory?.quantity || 0,
            minStock: inventory?.minStock || 10,
            status: inventory
              ? inventory.quantity === 0
                ? 'out_of_stock'
                : inventory.quantity <= inventory.minStock
                ? 'low_stock'
                : 'in_stock'
              : 'not_added',
          };
        });

        const totalQuantity = variantsWithInventory.reduce((sum, v) => sum + v.quantity, 0);
        const hasAnyInventory = variantsWithInventory.some((v) => v.hasInventory);

        // Determine overall stock status for product with variants
        const overallStockStatus = hasAnyInventory
          ? variantsWithInventory.some((v) => v.status === 'out_of_stock')
            ? 'out_of_stock'
            : variantsWithInventory.some((v) => v.status === 'low_stock')
            ? 'low_stock'
            : 'in_stock'
          : 'not_added';

        return {
          productId: product.id,
          productName: product.name,
          slug: product.slug,
          status: product.status,
          approvalStatus: product.approvalStatus,
          category: product.category?.name || null,
          brand: product.brand?.name || null,
          hasInventory: hasAnyInventory,
          totalQuantity,
          stockStatus: overallStockStatus,
          variants: variantsWithInventory,
        };
      } else {
        // Product without variants
        const key = `${product.id}-null`;
        const inventory = inventoryMap.get(key);

        return {
          productId: product.id,
          productName: product.name,
          slug: product.slug,
          status: product.status,
          approvalStatus: product.approvalStatus,
          category: product.category?.name || null,
          brand: product.brand?.name || null,
          hasInventory: !!inventory,
          totalQuantity: inventory?.quantity || 0,
          minStock: inventory?.minStock || 10,
          stockStatus: inventory
            ? inventory.quantity === 0
              ? 'out_of_stock'
              : inventory.quantity <= inventory.minStock
              ? 'low_stock'
              : 'in_stock'
            : 'not_added',
          variants: [],
        };
      }
    });

    res.json({
      success: true,
      data: {
        branch: {
          id: branch.id,
          name: branch.name,
        },
        products: productsWithInventory,
        summary: {
          totalProducts: products.length,
          productsWithInventory: productsWithInventory.filter((p) => p.hasInventory).length,
          productsNotAdded: productsWithInventory.filter((p) => !p.hasInventory).length,
        },
      },
    });
  } catch (e) {
    console.error('getBranchProductsWithInventory error:', e);
    console.error('Error stack:', e?.stack);
    res.status(500).json({
      success: false,
      message: e?.message || 'Server error',
      error: process.env.NODE_ENV === 'development' ? String(e) : undefined,
    });
  }
};

/**
 * POST /api/v1/owner/branches/:id/products/:productId/inventory
 * Create or update inventory for a product in a specific branch
 */
exports.upsertBranchProductInventory = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id || req.auth?.userId);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const branchId = parseInt(req.params.id);
    const productId = parseInt(req.params.productId);

    if (!branchId || !productId) {
      return res.status(400).json({ success: false, message: 'Invalid branch ID or product ID' });
    }

    const { variantId, quantity, minStock, expiryDate } = req.body;

    // Get owner's organizations
    const orgs = await prisma.organization.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);

    // Verify branch and product belong to owner's organization
    const [branch, product] = await Promise.all([
      prisma.branch.findFirst({
        where: { id: branchId, orgId: { in: orgIds } },
        select: { id: true, orgId: true },
      }),
      prisma.product.findFirst({
        where: { id: productId, orgId: { in: orgIds } },
        select: { id: true, orgId: true },
      }),
    ]);

    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (branch.orgId !== product.orgId) {
      return res.status(400).json({ success: false, message: 'Branch and product must belong to the same organization' });
    }

    // If variantId provided, verify it belongs to the product
    if (variantId) {
      const variant = await prisma.productVariant.findFirst({
        where: { id: parseInt(variantId), productId: productId },
      });

      if (!variant) {
        return res.status(404).json({ success: false, message: 'Variant not found for this product' });
      }
    }

    // Check if inventory already exists
    const existing = await prisma.inventory.findFirst({
      where: {
        branchId: branchId,
        productId: productId,
        variantId: variantId ? parseInt(variantId) : null,
      },
    });

    let inventory;
    if (existing) {
      // Update existing inventory
      inventory = await prisma.inventory.update({
        where: { id: existing.id },
        data: {
          quantity: quantity !== undefined ? parseInt(quantity) : existing.quantity,
          minStock: minStock !== undefined ? parseInt(minStock) : existing.minStock,
          expiryDate: expiryDate ? new Date(expiryDate) : existing.expiryDate,
        },
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, title: true, sku: true } },
          branch: { select: { id: true, name: true } },
        },
      });
    } else {
      // Create new inventory
      inventory = await prisma.inventory.create({
        data: {
          branchId: branchId,
          productId: productId,
          variantId: variantId ? parseInt(variantId) : null,
          quantity: quantity !== undefined ? parseInt(quantity) : 0,
          minStock: minStock !== undefined ? parseInt(minStock) : 10,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
        },
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, title: true, sku: true } },
          branch: { select: { id: true, name: true } },
        },
      });
    }

    res.json({
      success: true,
      data: inventory,
      message: existing ? 'Inventory updated successfully' : 'Inventory created successfully',
    });
  } catch (e) {
    console.error('upsertBranchProductInventory error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ----------------------------------------------------
// Owner Requests & Inventory placeholders (Phase: Requests page map)
// TODO: Replace with real implementations + Prisma models.
// ----------------------------------------------------

function buildMockProductRequests() {
  const now = Date.now();
  return [
    {
      id: 501,
      ref: 'PR-501',
      type: 'CREATE_PRODUCT',
      status: 'PENDING',
      payload: {
        name: 'Royal Canin Kitten 1kg',
        slug: 'royal-canin-kitten-1kg',
        variants: [{ sku: 'RC-KIT-1KG', title: '1kg' }],
      },
      requestedFromBranch: { id: 21, name: 'Gulshan Branch' },
      requestedBy: { id: 9001, profile: { displayName: 'Branch Manager' } },
      createdAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
      reviewedAt: null,
      note: null,
    },
    {
      id: 502,
      ref: 'PR-502',
      type: 'EDIT_PRODUCT',
      status: 'APPROVED',
      payload: {
        name: 'Acme Dog Food',
        slug: 'acme-dog-food',
        variants: [{ sku: 'ACM-DF-500', title: '500g' }],
      },
      requestedFromBranch: { id: 18, name: 'Dhanmondi Branch' },
      requestedBy: { id: 9010, profile: { displayName: 'Outlet Lead' } },
      createdAt: new Date(now - 1000 * 60 * 60 * 30).toISOString(),
      reviewedAt: new Date(now - 1000 * 60 * 60 * 4).toISOString(),
      note: 'Approved after price check',
    },
  ];
}

function buildMockInboxRequests(productRequests = []) {
  const now = Date.now();
  const list = [];

  (productRequests || []).forEach((pr) => {
    list.push({
      id: `PR-${pr.id}`,
      ref: pr.ref || `PR-${pr.id}`,
      kind: 'PRODUCT_REQUEST',
      title: pr.payload?.name || 'Product request',
      summary: pr.payload?.slug ? `slug: ${pr.payload.slug}` : '',
      status: pr.status || 'PENDING',
      branch: pr.requestedFromBranch || null,
      requestedBy: pr.requestedBy?.profile?.displayName || null,
      createdAt: pr.createdAt || new Date(now).toISOString(),
      href: `/owner/product-requests/${pr.id}`,
      meta: { type: pr.type || 'REQUEST' },
    });
  });

  list.push(
    {
      id: 'TR-1001',
      ref: 'TR-1001',
      kind: 'TRANSFER',
      title: 'Inter-branch transfer draft',
      summary: 'Warehouse → Branch transfer pending dispatch',
      status: 'PENDING',
      branch: { id: 11, name: 'Central Warehouse' },
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      href: '/owner/inventory/transfers/1001',
      meta: { fromBranch: 'Central Warehouse', toBranch: 'Gulshan Branch' },
    },
    {
      id: 'RET-900',
      ref: 'RET-900',
      kind: 'RETURN',
      title: 'Return request — Damaged items',
      summary: '2x wet food pouches reported damaged',
      status: 'PENDING',
      branch: { id: 18, name: 'Dhanmondi Branch' },
      createdAt: new Date(now - 1000 * 60 * 240).toISOString(),
      href: '/owner/returns/900',
    },
    {
      id: 'CAN-301',
      ref: 'CAN-301',
      kind: 'CANCELLATION',
      title: 'Cancellation approval needed',
      summary: 'Order #301 stock-out adjustment',
      status: 'REVIEW',
      branch: { id: 21, name: 'Gulshan Branch' },
      createdAt: new Date(now - 1000 * 60 * 540).toISOString(),
      href: '/owner/cancellations/301',
    }
  );

  return list;
}

function computePendingCounts(inbox = [], productRequests = []) {
  const isPending = (status) => {
    const s = String(status || '').toUpperCase();
    return s === 'PENDING' || s === 'REVIEW' || s === 'ACTION_REQUIRED' || s === 'SUBMITTED';
  };
  return {
    inbox: inbox.filter((r) => isPending(r.status)).length,
    productRequests: productRequests.filter((r) => isPending(r.status)).length,
    stockRequests: inbox.filter((r) => r.kind === 'STOCK_REQUEST' && isPending(r.status)).length,
    transfers: inbox.filter((r) => r.kind === 'TRANSFER' && isPending(r.status)).length,
    adjustments: inbox.filter((r) => r.kind === 'ADJUSTMENT' && isPending(r.status)).length,
    returns: inbox.filter((r) => r.kind === 'RETURN' && isPending(r.status)).length,
    cancellations: inbox.filter((r) => r.kind === 'CANCELLATION' && isPending(r.status)).length,
    notifications: inbox.filter((r) => r.kind === 'NOTIFICATION' && isPending(r.status)).length,
  };
}

async function getOwnerOrgIdsForRequest(prisma, userId) {
  if (!userId) return [];
  return getEffectiveOrgIdsForOwnerPanel(prisma, Number(userId));
}

async function getOwnerRequestsPendingCounts(prisma, orgIds) {
  if (!orgIds.length) {
    return {
      inbox: 0,
      productRequests: 0,
      stockRequests: 0,
      transfers: 0,
      adjustments: 0,
      returns: 0,
      cancellations: 0,
      notifications: 0,
    };
  }
  const [productRequests, stockRequests, adjustments, transferCount] = await Promise.all([
    prisma.productChangeRequest.count({ where: { orgId: { in: orgIds }, status: 'PENDING' } }),
    prisma.stockRequest.count({ where: { orgId: { in: orgIds }, status: 'SUBMITTED' } }),
    prisma.stockAdjustmentRequest.count({ where: { orgId: { in: orgIds }, status: 'PENDING' } }),
    prisma.stockTransfer.count({
      where: {
        status: { in: ['DRAFT', 'IN_TRANSIT'] },
        fromLocation: { branch: { orgId: { in: orgIds } } },
      },
    }),
  ]);
  const inbox =
    Number(productRequests) + Number(stockRequests) + Number(adjustments) + Number(transferCount);
  return {
    inbox,
    productRequests: Number(productRequests),
    stockRequests: Number(stockRequests),
    transfers: Number(transferCount),
    adjustments: Number(adjustments),
    returns: 0,
    cancellations: 0,
    notifications: 0,
  };
}

async function getOwnerRequestsInboxItems(prisma, orgIds) {
  if (!orgIds.length) return [];
  const [pcrRows, srRows, adjRows, transferRows] = await Promise.all([
    prisma.productChangeRequest.findMany({
      where: { orgId: { in: orgIds }, status: 'PENDING' },
      select: {
        id: true,
        type: true,
        status: true,
        payload: true,
        createdAt: true,
        requestedFromBranch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.stockRequest.findMany({
      where: { orgId: { in: orgIds }, status: 'SUBMITTED' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.stockAdjustmentRequest.findMany({
      where: { orgId: { in: orgIds }, status: 'PENDING' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.stockTransfer.findMany({
      where: {
        status: { in: ['DRAFT', 'IN_TRANSIT'] },
        fromLocation: { branch: { orgId: { in: orgIds } } },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        fromLocation: { select: { branch: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const list = [];
  const isPending = (s) => ['PENDING', 'REVIEW', 'ACTION_REQUIRED', 'SUBMITTED', 'DRAFT', 'IN_TRANSIT'].includes(String(s || '').toUpperCase());

  pcrRows.forEach((r) => {
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    list.push({
      id: `PR-${r.id}`,
      ref: `PR-${r.id}`,
      kind: 'PRODUCT_REQUEST',
      title: payload.name || 'Product change request',
      summary: payload.slug ? `slug: ${payload.slug}` : String(r.type || ''),
      status: r.status || 'PENDING',
      branch: r.requestedFromBranch ? { id: r.requestedFromBranch.id, name: r.requestedFromBranch.name } : null,
      requestedBy: r.requestedBy?.profile?.displayName || null,
      createdAt: r.createdAt?.toISOString?.() || new Date(r.createdAt).toISOString(),
      href: `/owner/product-requests/${r.id}`,
      meta: { type: r.type },
    });
  });
  srRows.forEach((r) => {
    list.push({
      id: `SR-${r.id}`,
      ref: `SR-${r.id}`,
      kind: 'STOCK_REQUEST',
      title: 'Stock request',
      summary: r.branch ? `From ${r.branch.name}` : '',
      status: r.status || 'SUBMITTED',
      branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
      requestedBy: r.requester?.profile?.displayName || null,
      createdAt: r.createdAt?.toISOString?.() || new Date(r.createdAt).toISOString(),
      href: `/owner/inventory/stock-requests/${r.id}`,
      meta: {},
    });
  });
  adjRows.forEach((r) => {
    const branchName = r.location?.branch?.name || r.location?.name || 'Location';
    list.push({
      id: `ADJ-${r.id}`,
      ref: `ADJ-${r.id}`,
      kind: 'ADJUSTMENT',
      title: 'Inventory adjustment request',
      summary: branchName,
      status: r.status || 'PENDING',
      branch: r.location?.branch ? { id: r.location.branch.id, name: r.location.branch.name } : null,
      requestedBy: null,
      createdAt: r.createdAt?.toISOString?.() || new Date(r.createdAt).toISOString(),
      href: `/owner/inventory/adjustments`,
      meta: {},
    });
  });
  transferRows.forEach((r) => {
    const branch = r.fromLocation?.branch;
    list.push({
      id: `TR-${r.id}`,
      ref: `TR-${r.id}`,
      kind: 'TRANSFER',
      title: 'Transfer',
      summary: branch ? `${branch.name}` : 'Inventory transfer',
      status: r.status || 'DRAFT',
      branch: branch ? { id: branch.id, name: branch.name } : null,
      requestedBy: null,
      createdAt: r.createdAt?.toISOString?.() || new Date(r.createdAt).toISOString(),
      href: `/owner/inventory/transfers/${r.id}`,
      meta: {},
    });
  });

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list.slice(0, 100);
}

exports.getOwnerRequestsInbox = async (req, res) => {
  try {
    const prisma = req.prisma ? getPrisma(req) : prismaClient;
    const userId = asIntId(req.user?.id || req.auth?.userId);
    const orgIds = await getOwnerOrgIdsForRequest(prisma, userId);

    const summaryOnly = String(req.query?.summary || '').trim() === '1';

    if (summaryOnly) {
      const pendingCounts = await getOwnerRequestsPendingCounts(prisma, orgIds);
      return res.json({
        success: true,
        data: [],
        meta: {
          pendingCounts,
          total: 0,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    const inbox = await getOwnerRequestsInboxItems(prisma, orgIds);
    const pendingCounts = computePendingCounts(inbox, []);

    res.json({
      success: true,
      data: inbox,
      meta: {
        pendingCounts,
        total: inbox.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('getOwnerRequestsInbox error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listOwnerProductRequests = async (req, res) => {
  try {
    const items = buildMockProductRequests();
    const requestedStatus = String(req.query?.status || '').toUpperCase();
    const list =
      requestedStatus && requestedStatus !== 'ALL'
        ? items.filter((r) => String(r.status || '').toUpperCase() === requestedStatus)
        : items;

    res.json({
      success: true,
      data: list,
      meta: {
        total: items.length,
        pending: items.filter((r) => String(r.status || '').toUpperCase() === 'PENDING').length,
      },
      message: 'Mock product requests. TODO: connect to real model.',
    });
  } catch (e) {
    console.error('listOwnerProductRequests error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock product requests)' });
  }
};

exports.createOwnerProductRequest = async (req, res) => {
  try {
    const body = req.body || {};
    const nextId = Math.floor(Math.random() * 9000) + 600;
    const mock = {
      id: nextId,
      ref: `PR-${nextId}`,
      status: 'PENDING',
      type: body.type || 'CREATE_PRODUCT',
      payload: body.payload || {},
      requestedFromBranch: body.branchId ? { id: body.branchId, name: `Branch #${body.branchId}` } : null,
      requestedBy: { id: req.user?.id || null, profile: { displayName: 'Owner (mock)' } },
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      note: null,
    };
    res.status(201).json({
      success: true,
      data: mock,
      message: 'Mock create product request. TODO: persist via Prisma.',
    });
  } catch (e) {
    console.error('createOwnerProductRequest error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock create product request)' });
  }
};

exports.approveOwnerProductRequest = async (req, res) => {
  try {
    const id = req.params?.id;
    res.json({
      success: true,
      data: {
        id,
        status: 'APPROVED',
        approvedAt: new Date().toISOString(),
      },
      message: 'Mock approve product request. TODO: implement business logic.',
    });
  } catch (e) {
    console.error('approveOwnerProductRequest error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock approve product request)' });
  }
};

exports.rejectOwnerProductRequest = async (req, res) => {
  try {
    const id = req.params?.id;
    const note = req.body?.note || null;
    res.json({
      success: true,
      data: {
        id,
        status: 'REJECTED',
        rejectedAt: new Date().toISOString(),
        note,
      },
      message: 'Mock reject product request. TODO: implement validation + persistence.',
    });
  } catch (e) {
    console.error('rejectOwnerProductRequest error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock reject product request)' });
  }
};

exports.createOwnerProductRequestTransfer = async (req, res) => {
  try {
    const id = req.params?.id;
    res.json({
      success: true,
      data: {
        requestId: id,
        transferDraftId: `TR-DRAFT-${id}`,
        status: 'DRAFT',
      },
      message: 'Mock transfer draft created from product request. TODO: link to transfer flow.',
    });
  } catch (e) {
    console.error('createOwnerProductRequestTransfer error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock transfer draft)' });
  }
};

exports.createOwnerInventoryTransfer = async (req, res) => {
  try {
    const nextId = Math.floor(Math.random() * 9000) + 2000;
    res.status(201).json({
      success: true,
      data: {
        id: nextId,
        reference: `TR-${nextId}`,
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        payload: req.body || {},
      },
      message: 'Mock inventory transfer created. TODO: persist and validate payload.',
    });
  } catch (e) {
    console.error('createOwnerInventoryTransfer error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock transfer create)' });
  }
};

exports.dispatchOwnerInventoryTransfer = async (req, res) => {
  try {
    const id = req.params?.id;
    res.json({
      success: true,
      data: {
        id,
        status: 'IN_TRANSIT',
        dispatchedAt: new Date().toISOString(),
      },
      message: 'Mock dispatch transfer. TODO: implement stock movement.',
    });
  } catch (e) {
    console.error('dispatchOwnerInventoryTransfer error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock transfer dispatch)' });
  }
};

exports.closeOwnerInventoryTransfer = async (req, res) => {
  try {
    const id = req.params?.id;
    res.json({
      success: true,
      data: {
        id,
        status: 'CLOSED',
        closedAt: new Date().toISOString(),
      },
      message: 'Mock close transfer. TODO: finalize ledger entries.',
    });
  } catch (e) {
    console.error('closeOwnerInventoryTransfer error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Server error (mock transfer close)' });
  }
};
