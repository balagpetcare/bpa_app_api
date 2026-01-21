const { writeAudit } = require('../../../../middlewares/auditWriter');
const mediaService = require('../media/media.service');
const { processUploadFile } = require('../media/media.processor');

const REQUIRED_OWNER_KYC_DOCS = ['NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID'];

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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const name = req.body?.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const divisionId = asIntId(req.body?.divisionId);
    const districtId = asIntId(req.body?.districtId);
    const upazilaId = asIntId(req.body?.upazilaId);
    const areaId = asIntId(req.body?.areaId);

    const vr = await validateBdLocationRefs(prisma, { divisionId, districtId, upazilaId, areaId });
    if (!vr.ok) return res.status(400).json({ success: false, message: vr.message });

    const before = await prisma.ownerProfile.findUnique({ where: { userId: ownerUserId } });

    const saved = await prisma.ownerProfile.upsert({
      where: { userId: ownerUserId },
      create: {
        userId: ownerUserId,
        name,
        nid: req.body?.nid ? String(req.body.nid).trim() : null,
        supportPhone: req.body?.supportPhone ? String(req.body.supportPhone).trim() : null,
        supportEmail: req.body?.supportEmail ? String(req.body.supportEmail).trim() : null,
        divisionId,
        districtId,
        upazilaId,
        areaId,
        dateOfBirth: req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null,
        genderText: req.body?.genderText ? String(req.body.genderText).trim() : null,
      },
      update: {
        name,
        nid: req.body?.nid ? String(req.body.nid).trim() : null,
        supportPhone: req.body?.supportPhone ? String(req.body.supportPhone).trim() : null,
        supportEmail: req.body?.supportEmail ? String(req.body.supportEmail).trim() : null,
        divisionId,
        districtId,
        upazilaId,
        areaId,
        dateOfBirth: req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null,
        genderText: req.body?.genderText ? String(req.body.genderText).trim() : null,
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Minimal required for draft: fullName (we keep schema strict, but draft is still an upsert).
    const fullName = req.body?.fullName ? String(req.body.fullName).trim() : '';
    if (!fullName) return res.status(400).json({ success: false, message: 'fullName is required' });

    const presentAddressJson = req.body?.presentAddressJson && typeof req.body.presentAddressJson === 'object' ? req.body.presentAddressJson : null;
    const permanentAddressJson = req.body?.permanentAddressJson && typeof req.body.permanentAddressJson === 'object' ? req.body.permanentAddressJson : null;

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
        nidAddressRaw: req.body?.nidAddressRaw ? String(req.body.nidAddressRaw).trim() : null,
        mobile: req.body?.mobile ? String(req.body.mobile).trim() : null,
        email: req.body?.email ? String(req.body.email).trim() : null,
        presentAddressJson,
        permanentAddressJson,
        emergencyContactName: req.body?.emergencyContactName ? String(req.body.emergencyContactName).trim() : null,
        emergencyContactPhone: req.body?.emergencyContactPhone ? String(req.body.emergencyContactPhone).trim() : null,
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
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const kyc = await prisma.ownerKyc.findUnique({ where: { userId: ownerUserId } });
    if (!kyc) return res.status(400).json({ success: false, message: 'KYC not found. Save draft first.' });
    if (kyc.isLocked) return res.status(403).json({ success: false, message: 'KYC is locked' });

    const type = normalizeDocType(req.body?.type);
    if (!type) return res.status(400).json({ success: false, message: 'type is required' });

    // Validate enum value safely: check existence in Prisma enum map at runtime by querying allowed values.
    // Since JS cannot import Prisma enums reliably here, we enforce a conservative allowlist:
    const allowed = new Set([
      'NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID',
      'OTHER'
    ]);
    if (!allowed.has(type)) {
      return res.status(400).json({ success: false, message: `Invalid document type: ${type}` });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use multipart/form-data field name 'file'." });
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
      entityType: 'OWNER_KYC_DOCUMENT',
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
    const ownerUserId = asIntId(req.user.id);
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
      entityType: 'OWNER_KYC_DOCUMENT',
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
    const ownerUserId = asIntId(req.user.id);
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

    const before = current;
    const saved = await prisma.ownerKyc.update({
      where: { userId: ownerUserId },
      data: {
        verificationStatus: 'SUBMITTED',
        submittedAt: new Date(),
        rejectionReason: null,
        reviewNote: null
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

    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.createOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const name = req.body?.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    // This project already uses Organization.status = PartnerStatus
    // We'll store location + extra fields inside addressJson to keep DB stable.
    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : {};
    const created = await prisma.organization.create({
      data: {
        ownerUserId,
        name,
        supportPhone: req.body?.supportPhone ? String(req.body.supportPhone).trim() : null,
        // email is not in current Organization model; keep inside addressJson
        status: 'NOT_APPLIED',
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
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const status = req.query.status ? String(req.query.status) : null;

    const rows = await prisma.organization.findMany({
      where: {
        ownerUserId,
        ...(status ? { status } : {})
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.getOrganization = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const id = asIntId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });

    const org = await prisma.organization.findFirst({
      where: { id, ownerUserId },
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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

exports.getBranch = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const branchId = asIntId(req.params.id);
    if (!branchId) return res.status(400).json({ success: false, message: 'Invalid branch id' });

    const branch = await ensureOwnerBranch(prisma, ownerUserId, branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const addressJson = req.body?.addressJson && typeof req.body.addressJson === 'object' ? req.body.addressJson : undefined;
    // best-effort: validate Bangladesh location refs if they exist on the payload
    if (addressJson) {
      const vr = await validateBdLocationRefs(prisma, {
        divisionId: asIntId(addressJson.divisionId),
        districtId: asIntId(addressJson.districtId),
        upazilaId: asIntId(addressJson.upazilaId),
        areaId: asIntId(addressJson.areaId),
      });
      if (!vr.ok) return res.status(400).json({ success: false, message: vr.message });
    }

    const saved = await upsertBranchProfileDetails(prisma, branchId, {
      branchPhone: req.body?.branchPhone !== undefined ? String(req.body.branchPhone || '').trim() : undefined,
      branchEmail: req.body?.branchEmail !== undefined ? String(req.body.branchEmail || '').trim() : undefined,
      managerName: req.body?.managerName !== undefined ? String(req.body.managerName || '').trim() : undefined,
      managerPhone: req.body?.managerPhone !== undefined ? String(req.body.managerPhone || '').trim() : undefined,
      addressJson,
      googleMapLink: req.body?.googleMapLink !== undefined ? String(req.body.googleMapLink || '').trim() : undefined,
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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
    const ownerUserId = asIntId(req.user.id);
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

// GET /api/v1/owner/product-change-requests?status=PENDING
exports.listProductChangeRequests = async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING");
    const where = { status };
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


/**
 * POST /api/v1/owner/branches/:id/members/invite
 * Body: { phone? , email? , displayName?, role }
 * Creates a token-based invite (no temp password in API response).
 */
exports.inviteBranchMember = async (req, res) => {
  try {
    const branchId = Number(req.params.id);
    const { phone, email, displayName, role } = req.body || {};

    if (!role) return res.status(400).json({ success: false, message: "role is required" });

    const emailNorm = (email || "").trim().toLowerCase() || null;
    const phoneNorm = (phone || "").trim().replace(/\D/g, "") || null;

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: "phone or email is required" });
    }

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

    const isDeliveryHub = hasDeliveryHubType(branch);
    if (!isRoleAllowedForBranch(isDeliveryHub, role)) {
      return res.status(400).json({ success: false, message: "Invalid role for this branch type" });
    }

    const crypto = require("crypto");
    const rawToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

    const invite = await prismaClient.staffInvite.create({
      data: {
        orgId: branch.orgId,
        branchId: branch.id,
        role: String(role),
        status: "PENDING",
        email: emailNorm,
        phone: phoneNorm,
        displayName: displayName ? String(displayName) : null,
        tokenHash,
        expiresAt,
        invitedByUserId: req.user.id,
      },
    });

    const { sendInvite } = require("../../../../utils/inviteNotifier");
    const channel = phoneNorm ? "SMS" : "EMAIL";
    const to = phoneNorm ? phoneNorm : emailNorm;
    const link = `${process.env.PANEL_PUBLIC_URL || ""}/invite/accept?token=${rawToken}`;
    const msg = `BPA Invite: You are invited as ${role} for branch "${branch.name}". Accept: ${link}`;
    await sendInvite({ channel, to, message: msg });

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
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict" });
    }
    return res.status(500).json({
      success: false,
      message: isProd ? "Server error" : (e?.message || "Server error"),
    });
  }
};

export {};
