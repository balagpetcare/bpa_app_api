const { writeAudit } = require('../../../../middlewares/auditWriter');
const mediaService = require('../media/media.service');
const { processUploadFile } = require('../media/media.processor');

function asIntId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function normalizeEnum(v) {
  if (!v) return null;
  return String(v).trim().toUpperCase();
}

async function ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId) {
  if (entityType === 'OWNER') {
    if (entityId !== ownerUserId) throw new Error('Forbidden');
    return true;
  }

  if (entityType === 'ORGANIZATION') {
    const org = await prisma.organization.findUnique({ where: { id: entityId }, select: { ownerUserId: true } });
    if (!org || org.ownerUserId !== ownerUserId) throw new Error('Forbidden');
    return true;
  }

  if (entityType === 'BRANCH') {
    const br = await prisma.branch.findUnique({
      where: { id: entityId },
      select: { org: { select: { ownerUserId: true } } },
    });
    if (!br || br.org?.ownerUserId !== ownerUserId) throw new Error('Forbidden');
    return true;
  }

  throw new Error('Invalid entityType');
}

async function getOrCreateActiveCase(prisma, entityType, entityId) {
  const active = await prisma.verificationCase.findFirst({
    where: {
      entityType,
      entityId,
      status: { in: ['DRAFT', 'REJECTED', 'SUBMITTED'] },
    },
    orderBy: { createdAt: 'desc' },
    include: { documents: { include: { media: true } }, events: true },
  });

  if (active) return active;

  // If no active case exists, return the latest case (e.g., APPROVED) instead of creating
  // a new draft automatically. Owners must explicitly request a change after approval.
  const latest = await prisma.verificationCase.findFirst({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    include: { documents: { include: { media: true } }, events: true },
  });
  if (latest) return latest;

  const created = await prisma.verificationCase.create({
    data: {
      entityType,
      entityId,
      status: 'DRAFT',
    },
    include: { documents: { include: { media: true } }, events: true },
  });

  return created;
}

async function getLatestCase(prisma, entityType, entityId) {
  return await prisma.verificationCase.findFirst({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    include: { documents: { include: { media: true } }, events: true },
  });
}

exports.getVerificationCase = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.query?.entityType) || 'OWNER';
    const rawEntityId = req.query?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    // Prefer an active (draft/submitted/rejected) case; fallback to latest approved.
    const vc = await getOrCreateActiveCase(prisma, entityType, entityId);
    return res.json({ success: true, data: vc });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};

// ------------------------------
// V3: Approved entity edit flow
// If the latest case is APPROVED, create a new DRAFT case for change request.
// This enables "approve -> edit -> re-verify" without breaking existing APIs.
// ------------------------------
exports.requestVerificationChange = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.body?.entityType) || 'OWNER';
    const rawEntityId = req.body?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    const latest = await getLatestCase(prisma, entityType, entityId);
    if (!latest) {
      const created = await getOrCreateActiveCase(prisma, entityType, entityId);
      return res.json({ success: true, data: created, message: 'Draft created' });
    }

    // If there is an active case already, return it.
    if (['DRAFT', 'REJECTED', 'SUBMITTED'].includes(latest.status)) {
      return res.json({ success: true, data: latest, message: 'Active case exists' });
    }

    if (latest.status !== 'APPROVED') {
      // Unknown status; be safe.
      const created = await getOrCreateActiveCase(prisma, entityType, entityId);
      return res.json({ success: true, data: created, message: 'Draft created' });
    }

    const created = await prisma.verificationCase.create({
      data: {
        entityType,
        entityId,
        status: 'DRAFT',
        // Start from latest approved snapshot (optional)
        payloadJson: latest.payloadJson ?? null,
      },
      include: { documents: { include: { media: true } }, events: true },
    });

    await prisma.verificationCaseEvent.create({
      data: {
        caseId: created.id,
        action: 'REQUEST_CHANGE',
        from: 'APPROVED',
        to: 'DRAFT',
        note: req.body?.note ? String(req.body.note) : 'Owner requested change after approval',
      },
    });

    await prisma.notification.create({
      data: {
        userId: ownerUserId,
        type: 'SYSTEM',
        title: 'Change request started',
        message: `A new ${entityType.toLowerCase()} verification draft has been created. Update info and submit again for review.`,
        meta: { entityType, entityId, caseId: created.id },
      },
    });

    return res.json({ success: true, data: created, message: 'Change request draft created' });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};

exports.updateVerificationDraft = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.body?.entityType) || 'OWNER';
    const rawEntityId = req.body?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    const vc = await getOrCreateActiveCase(prisma, entityType, entityId);
    if (vc.status === 'SUBMITTED') {
      // V2 Soft Gate: do not break anything; just inform.
      return res.json({
        success: true,
        verificationBlocked: true,
        message: 'Verification case is submitted and waiting for review. Edit is temporarily locked.',
        data: vc,
      });
    }

    const payloadJson = req.body?.payloadJson ?? req.body?.payload ?? null;

    const updated = await prisma.verificationCase.update({
      where: { id: vc.id },
      data: { payloadJson },
      include: { documents: { include: { media: true } }, events: true },
    });

    await writeAudit({
      prisma,
      req,
      action: 'VERIFICATION_CASE_DRAFT_UPDATE',
      entityType: 'VERIFICATION_CASE',
      entityId: updated.id,
      before: { payloadJson: vc.payloadJson },
      after: { payloadJson: updated.payloadJson },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};

exports.uploadVerificationDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.body?.entityType) || 'OWNER';
    const rawEntityId = req.body?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    const vc = await getOrCreateActiveCase(prisma, entityType, entityId);
    if (vc.status === 'SUBMITTED') {
      return res.status(200).json({
        success: true,
        verificationBlocked: true,
        message: 'Verification case is submitted and waiting for review. Upload is temporarily locked.',
        data: vc,
      });
    }

    const docType = normalizeEnum(req.body?.docType || req.body?.type);
    if (!docType) return res.status(400).json({ success: false, message: 'docType is required' });

    // Allow only known enum values from DocumentType
    const allowed = new Set([
      'NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID',
      'TRADE_LICENSE', 'TIN_CERT', 'BIN_CERT', 'INCORPORATION_CERT', 'PARTNERSHIP_DEED',
      'BOARD_RESOLUTION', 'BANK_CHEQUE_LEAF',
      'STORE_FRONT_PHOTO', 'STORE_INSIDE_PHOTO', 'SIGNBOARD_PHOTO', 'VET_LICENSE', 'DRUG_LICENSE',
      'OTHER'
    ]);
    if (!allowed.has(docType)) {
      return res.status(400).json({ success: false, message: `Invalid docType: ${docType}` });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use multipart/form-data field name 'file'." });
    }

    const processed = await processUploadFile(file);
    const media = await mediaService.uploadAndCreateMedia({
      ownerUserId,
      file: processed,
      folder: `verification/${entityType.toLowerCase()}`,
    });

    // If a document of same type exists for this case, bump version and create new record (append-only).
    const lastSame = await prisma.verificationDocument.findFirst({
      where: { caseId: vc.id, docType },
      orderBy: { version: 'desc' },
    });

    const created = await prisma.verificationDocument.create({
      data: {
        caseId: vc.id,
        docType,
        status: 'PENDING',
        isRequired: req.body?.isRequired === undefined ? true : Boolean(req.body.isRequired),
        mediaId: media.id,
        version: (lastSame?.version || 0) + 1,
        docNumber: req.body?.docNumber ? String(req.body.docNumber).trim() : null,
        issueDate: req.body?.issueDate ? new Date(req.body.issueDate) : null,
        expiryDate: req.body?.expiryDate ? new Date(req.body.expiryDate) : null,
      },
      include: { media: true },
    });

    await writeAudit({
      prisma,
      req,
      action: 'VERIFICATION_DOCUMENT_UPLOAD',
      entityType: 'VERIFICATION_DOCUMENT',
      entityId: created.id,
      before: null,
      after: created,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};

exports.deleteVerificationDocument = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const docId = asIntId(req.params.id);
    if (!docId) return res.status(400).json({ success: false, message: 'Invalid id' });

    const doc = await prisma.verificationDocument.findUnique({
      where: { id: docId },
      include: { verificationCase: true },
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    const vc = doc.verificationCase;
    await ensureOwnerEntityAccess(prisma, ownerUserId, vc.entityType, vc.entityId);

    if (vc.status === 'SUBMITTED') {
      return res.json({ success: true, verificationBlocked: true, message: 'Submitted case cannot be edited yet.' });
    }

    await prisma.verificationDocument.delete({ where: { id: docId } });

    await writeAudit({
      prisma,
      req,
      action: 'VERIFICATION_DOCUMENT_DELETE',
      entityType: 'VERIFICATION_DOCUMENT',
      entityId: docId,
      before: doc,
      after: null,
    });

    return res.json({ success: true });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};

exports.submitVerificationCase = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.body?.entityType) || 'OWNER';
    const rawEntityId = req.body?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    const vc = await getOrCreateActiveCase(prisma, entityType, entityId);
    if (vc.status === 'SUBMITTED') {
      return res.json({ success: true, data: vc, message: 'Already submitted' });
    }

    const updated = await prisma.verificationCase.update({
      where: { id: vc.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
      include: { documents: { include: { media: true } }, events: true },
    });

    await prisma.verificationCaseEvent.create({
      data: {
        caseId: updated.id,
        action: 'SUBMIT',
        from: vc.status,
        to: 'SUBMITTED',
        note: req.body?.note ? String(req.body.note) : null,
      },
    });

    // Owner notification (admin notification can be added in later versions)
    await prisma.notification.create({
      data: {
        userId: ownerUserId,
        type: 'VERIFICATION_CASE_SUBMITTED',
        title: 'Verification submitted',
        message: `Your ${entityType.toLowerCase()} verification has been submitted for review.`,
        meta: { entityType, entityId, caseId: updated.id },
      },
    });

    await writeAudit({
      prisma,
      req,
      action: 'VERIFICATION_CASE_SUBMIT',
      entityType: 'VERIFICATION_CASE',
      entityId: updated.id,
      before: vc,
      after: updated,
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    const msg = e?.message || 'Server error';
    const status = msg === 'Forbidden' ? 403 : 500;
    return res.status(status).json({ success: false, message: msg });
  }
};


exports.requestChange = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const ownerUserId = asIntId(req.user?.id);
    if (!ownerUserId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const entityType = normalizeEnum(req.body?.entityType) || 'OWNER';
    const rawEntityId = req.body?.entityId;
    const entityId = entityType === 'OWNER' ? ownerUserId : asIntId(rawEntityId);
    if (!entityId) return res.status(400).json({ success: false, message: 'Invalid entityId' });

    await ensureOwnerEntityAccess(prisma, ownerUserId, entityType, entityId);

    const vc = await prisma.verificationCase.create({
      data: {
        entityType,
        entityId,
        status: 'DRAFT',
        payloadJson: null,
        events: {
          create: {
            action: 'REQUEST_CHANGE',
            message: 'Owner requested to change approved/submitted data; new draft created for re-verification.',
          },
        },
      },
      include: { documents: true, events: true },
    });

    return res.json({ success: true, data: vc });
  } catch (e) {
    console.error('requestChange error', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export {};
