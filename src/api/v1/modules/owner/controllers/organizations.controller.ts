const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { prisma } = require('../../../utils/prisma');

const basicUpdateSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  supportPhone: z.string().min(6).max(30).optional().nullable(),
  addressJson: z.any().optional().nullable(),
});

const legalProfileSchema = z.object({
  organizationName: z.string().min(2).max(150).optional(),
  registrationType: z.enum(["PROPRIETORSHIP","PARTNERSHIP","LIMITED_COMPANY","NGO"]).optional(),
  tradeLicenseNumber: z.string().max(50).optional().nullable(),
  tradeLicenseIssueDate: z.coerce.date().optional().nullable(),
  tradeLicenseExpiryDate: z.coerce.date().optional().nullable(),
  issuingAuthority: z.string().max(100).optional().nullable(),
  tinNumber: z.string().max(50).optional().nullable(),
  binNumber: z.string().max(50).optional().nullable(),
  officialPhone: z.string().max(30).optional().nullable(),
  officialEmail: z.string().email().optional().nullable(),
  website: z.string().max(200).optional().nullable(),
  facebookPage: z.string().max(200).optional().nullable(),
  bankAccountName: z.string().max(150).optional().nullable(),
  bankAccountNumber: z.string().max(80).optional().nullable(),
  bankName: z.string().max(150).optional().nullable(),
  bankBranchName: z.string().max(150).optional().nullable(),
  routingNumber: z.string().max(30).optional().nullable(),
  payoutBkash: z.string().max(30).optional().nullable(),
  payoutNagad: z.string().max(30).optional().nullable(),
  payoutRocket: z.string().max(30).optional().nullable(),
});

function httpError(statusCode, message) {
  const err = new Error(message);
  (err as any).statusCode = statusCode;
  return err;
}

async function assertOrgOwnership(orgId, ownerUserId) {
  const org = await prisma.organization.findFirst({
    where: { id: orgId, ownerUserId },
    include: {
      legalProfile: {
        include: { documents: { include: { media: true } }, directors: true },
      },
      branches: true,
    },
  });
  if (!org) throw httpError(404, 'Organization not found');
  return org;
}

function isLockedByVerification(legalProfile) {
  // Once VERIFIED, owner can no longer edit.
  return legalProfile?.verificationStatus === 'VERIFIED';
}

async function listMyOrganizations(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const items = await prisma.organization.findMany({
      where: { ownerUserId },
      orderBy: { id: 'desc' },
      include: {
        legalProfile: { include: { documents: { include: { media: true } } } },
      },
    });
    res.json({ success: true, data: items });
  } catch (e) {
    next(e);
  }
}

async function getMyOrganizationById(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    if (Number.isNaN(orgId)) throw httpError(400, 'Invalid organization id');

    const org = await assertOrgOwnership(orgId, ownerUserId);
    res.json({ success: true, data: org });
  } catch (e) {
    next(e);
  }
}

async function updateMyOrganizationBasic(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    if (Number.isNaN(orgId)) throw httpError(400, 'Invalid organization id');

    const org = await assertOrgOwnership(orgId, ownerUserId);
    if (isLockedByVerification(org.legalProfile)) {
      throw httpError(409, 'Organization is VERIFIED. Basic info can no longer be edited.');
    }

    const data = basicUpdateSchema.parse(req.body || {});

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.supportPhone !== undefined ? { supportPhone: data.supportPhone } : {}),
        ...(data.addressJson !== undefined ? { addressJson: data.addressJson } : {}),
      },
      include: {
        legalProfile: { include: { documents: { include: { media: true } }, directors: true } },
        branches: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    if (e instanceof z.ZodError) return next(httpError(400, e.errors?.[0]?.message || 'Invalid data'));
    next(e);
  }
}

async function upsertMyOrganizationLegalProfile(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    if (Number.isNaN(orgId)) throw httpError(400, 'Invalid organization id');

    const org = await assertOrgOwnership(orgId, ownerUserId);
    if (isLockedByVerification(org.legalProfile)) {
      throw httpError(409, 'Organization is VERIFIED. Legal profile can no longer be edited.');
    }

    const body = legalProfileSchema.parse(req.body || {});

    // Ensure org legal profile exists (create if missing)
    const updated = await prisma.organizationLegalProfile.upsert({
      where: { orgId },
      create: {
        orgId,
        organizationName: body.organizationName || org.name,
        ...(body.registrationType ? { registrationType: body.registrationType } : {}),
        ...body,
      },
      update: {
        ...body,
        // allow owner to re-submit after rejection by editing
        ...(org.legalProfile?.verificationStatus === 'REJECTED'
          ? { rejectionReason: null }
          : {}),
      },
      include: { documents: { include: { media: true } }, directors: true },
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    if (e instanceof z.ZodError) return next(httpError(400, e.errors?.[0]?.message || 'Invalid data'));
    next(e);
  }
}

async function submitMyOrganizationForReview(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    if (Number.isNaN(orgId)) throw httpError(400, 'Invalid organization id');

    const org = await assertOrgOwnership(orgId, ownerUserId);

    // Must have legal profile
    if (!org.legalProfile) {
      throw httpError(400, 'Legal profile missing. Update /legal-profile first.');
    }

    if (org.legalProfile.verificationStatus === 'VERIFIED') {
      throw httpError(409, 'Already VERIFIED');
    }

    const updated = await prisma.organizationLegalProfile.update({
      where: { orgId },
      data: {
        verificationStatus: 'SUBMITTED',
        submittedAt: new Date(),
        rejectionReason: null,
        reviewNote: null,
      },
      include: { documents: { include: { media: true } }, directors: true },
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

async function uploadOrgDocument(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    if (Number.isNaN(orgId)) throw httpError(400, 'Invalid organization id');

    const org = await assertOrgOwnership(orgId, ownerUserId);
    if (!org.legalProfile) {
      throw httpError(400, 'Legal profile missing. Update /legal-profile first.');
    }
    if (isLockedByVerification(org.legalProfile)) {
      throw httpError(409, 'Organization is VERIFIED. Documents can no longer be edited.');
    }

    const file = req.file;
    if (!file) throw httpError(400, 'file is required (multipart field: file)');

    const docType = String(req.body.type || 'TRADE_LICENSE');

    // create Media row
    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const url = `${publicBase}/${uploadDir}/org-docs/${file.filename}`;

    const media = await prisma.media.create({
      data: {
        url,
        key: file.filename,
        type: file.mimetype,
        ownerUserId,
      },
    });

    const doc = await prisma.organizationDocument.create({
      data: {
        orgLegalProfileId: org.legalProfile.id,
        type: docType,
        status: 'SUBMITTED',
        mediaId: media.id,
        docNumber: req.body.docNumber || null,
        issueDate: req.body.issueDate ? new Date(req.body.issueDate) : null,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        note: req.body.note || null,
      },
      include: { media: true },
    });

    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
}

async function deleteOrgDocument(req, res, next) {
  try {
    const ownerUserId = req.auth.userId;
    const orgId = Number(req.params.id);
    const docId = Number(req.params.docId);
    if (Number.isNaN(orgId) || Number.isNaN(docId)) throw httpError(400, 'Invalid id');

    const org = await assertOrgOwnership(orgId, ownerUserId);
    if (!org.legalProfile) throw httpError(400, 'Legal profile missing');
    if (isLockedByVerification(org.legalProfile)) {
      throw httpError(409, 'Organization is VERIFIED. Documents can no longer be edited.');
    }

    const doc = await prisma.organizationDocument.findFirst({
      where: { id: docId, orgLegalProfileId: org.legalProfile.id },
      include: { media: true },
    });
    if (!doc) throw httpError(404, 'Document not found');

    // Soft-delete media (keep record)
    await prisma.media.update({
      where: { id: doc.mediaId },
      data: { deletedAt: new Date() },
    });

    // Hard delete doc row (optional). If you prefer soft delete, add deletedAt in schema later.
    await prisma.organizationDocument.delete({ where: { id: docId } });

    // delete physical file best-effort
    try {
      const uploadDir = process.env.UPLOAD_DIR || 'uploads';
      const filePath = path.join(process.cwd(), uploadDir, 'org-docs', doc.media.key || '');
      if (doc.media.key && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listMyOrganizations,
  getMyOrganizationById,
  updateMyOrganizationBasic,
  upsertMyOrganizationLegalProfile,
  submitMyOrganizationForReview,
  uploadOrgDocument,
  deleteOrgDocument,
};

export {};
