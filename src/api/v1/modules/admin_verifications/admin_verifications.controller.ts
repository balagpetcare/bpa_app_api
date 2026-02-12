const prisma = require("../../../../infrastructure/db/prismaClient");

function pickStatus(req) {
  const s = String(req.query.status || "").trim();
  return s || null;
}

function producerStatusToVerificationStatus(status) {
  if (status === "VERIFIED") return "VERIFIED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "PENDING") return "SUBMITTED";
  return null;
}

async function logAction({ entityType, entityId, action, fromStatus, toStatus, adminUserId, note }) {
  try {
    await prisma.verificationLog.create({
      data: {
        entityType,
        entityId,
        action,
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        adminUserId: adminUserId ? Number(adminUserId) : null,
        note: note || null,
      },
    });
  } catch (e) {
    console.error("verificationLog error", e);
  }
}

async function addComment({ entityType, entityId, adminUserId, comment, internalOnly }) {
  // We log comments as VERIFICATION_LOG rows so we don't need new tables/migrations.
  await logAction({
    entityType,
    entityId,
    action: internalOnly ? 'INTERNAL_NOTE' : 'COMMENT',
    fromStatus: null,
    toStatus: null,
    adminUserId,
    note: comment,
  });
}

// ---------------- Owners ----------------
exports.listOwnerKycs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const where = status ? { verificationStatus: status } : {};
    const rows = await prisma.ownerKyc.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { id: true, status: true, auth: true } } },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listOwnerKycs error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.ownerKyc.findUnique({
      where: { id },
      include: { documents: { include: { media: true } }, user: { select: { id: true, auth: true, status: true } } },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const logs = await prisma.verificationLog.findMany({
      where: { entityType: "OWNER", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ success: true, data: { ...row, logs } });
  } catch (e) {
    console.error("getOwnerKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.ownerKyc.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.ownerKyc.update({
      where: { id },
      data: {
        verificationStatus: "VERIFIED",
        reviewedAt: new Date(),
        reviewedByAdminId: adminUserId,
        rejectionReason: null,
        kycLevel: 1, // Progressive KYC: Level 1 = verified basic
      },
    });

    await logAction({ entityType: "OWNER", entityId: id, action: "APPROVE", fromStatus: current.verificationStatus, toStatus: "VERIFIED", adminUserId, note: req.body?.note });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveOwnerKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.ownerKyc.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.ownerKyc.update({
      where: { id },
      data: { verificationStatus: "REJECTED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, rejectionReason: String(reason), reviewNote: note || null },
    });

    await logAction({ entityType: "OWNER", entityId: id, action: "REJECT", fromStatus: current.verificationStatus, toStatus: "REJECTED", adminUserId, note: note || reason });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectOwnerKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.requestChangesOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.ownerKyc.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.ownerKyc.update({
      where: { id },
      data: { verificationStatus: "REQUEST_CHANGES", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null },
    });

    await logAction({ entityType: "OWNER", entityId: id, action: "REQUEST_CHANGES", fromStatus: current.verificationStatus, toStatus: "REQUEST_CHANGES", adminUserId, note });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("requestChangesOwnerKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.suspendOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.ownerKyc.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.ownerKyc.update({
      where: { id },
      data: { verificationStatus: "SUSPENDED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null, isLocked: true, lockReason: note || "Suspended by admin" },
    });

    await logAction({ entityType: "OWNER", entityId: id, action: "SUSPEND", fromStatus: current.verificationStatus, toStatus: "SUSPENDED", adminUserId, note });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("suspendOwnerKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.commentOwnerKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { comment, internalOnly } = req.body || {};
    if (!comment) return res.status(400).json({ success: false, message: 'comment is required' });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.ownerKyc.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });

    // Keep latest message on the record for quick preview in lists.
    await prisma.ownerKyc.update({ where: { id }, data: { reviewNote: String(comment).slice(0, 500) } });
    await addComment({ entityType: 'OWNER', entityId: id, adminUserId, comment: String(comment), internalOnly: !!internalOnly });

    return res.json({ success: true });
  } catch (e) {
    console.error('commentOwnerKyc error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ---------------- Organizations ----------------
exports.listOrgKycs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const where = status ? { verificationStatus: status } : {};
    const rows = await prisma.organizationLegalProfile.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { organization: { select: { id: true, name: true, ownerUserId: true, status: true } } },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listOrgKycs error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.organizationLegalProfile.findUnique({
      where: { id },
      include: { documents: { include: { media: true } }, directors: true, organization: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const logs = await prisma.verificationLog.findMany({
      where: { entityType: "ORGANIZATION", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ success: true, data: { ...row, logs } });
  } catch (e) {
    console.error("getOrgKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.organizationLegalProfile.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const lp = await tx.organizationLegalProfile.update({
        where: { id },
        data: { verificationStatus: "VERIFIED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, rejectionReason: null },
      });

      // Keep org status in sync for Owner panel UX.
      // (If schema uses an enum and the value doesn't exist, ignore without failing.)
      try {
        await tx.organization.update({ where: { id: lp.orgId }, data: { status: "APPROVED" } });
      } catch (orgErr) {
        console.warn("organization.status update failed (ignored):", orgErr?.message || orgErr);
      }

      return lp;
    });
    await logAction({ entityType: "ORGANIZATION", entityId: id, action: "APPROVE", fromStatus: current.verificationStatus, toStatus: "VERIFIED", adminUserId, note: req.body?.note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveOrgKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.organizationLegalProfile.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const lp = await tx.organizationLegalProfile.update({
        where: { id },
        data: { verificationStatus: "REJECTED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, rejectionReason: String(reason), reviewNote: note || null },
      });
      try {
        await tx.organization.update({ where: { id: lp.orgId }, data: { status: "REJECTED" } });
      } catch (orgErr) {
        console.warn("organization.status update failed (ignored):", orgErr?.message || orgErr);
      }
      return lp;
    });
    await logAction({ entityType: "ORGANIZATION", entityId: id, action: "REJECT", fromStatus: current.verificationStatus, toStatus: "REJECTED", adminUserId, note: note || reason });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectOrgKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.requestChangesOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.organizationLegalProfile.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const lp = await tx.organizationLegalProfile.update({
        where: { id },
        data: { verificationStatus: "REQUEST_CHANGES", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null },
      });
      try {
        // Draft for Organization is PartnerStatus.NOT_APPLIED
        await tx.organization.update({ where: { id: lp.orgId }, data: { status: "NOT_APPLIED" } });
      } catch (orgErr) {
        console.warn("organization.status update failed (ignored):", orgErr?.message || orgErr);
      }
      return lp;
    });
    await logAction({ entityType: "ORGANIZATION", entityId: id, action: "REQUEST_CHANGES", fromStatus: current.verificationStatus, toStatus: "REQUEST_CHANGES", adminUserId, note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("requestChangesOrgKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.suspendOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.organizationLegalProfile.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const lp = await tx.organizationLegalProfile.update({
        where: { id },
        data: { verificationStatus: "SUSPENDED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null },
      });
      try {
        await tx.organization.update({ where: { id: lp.orgId }, data: { status: "SUSPENDED" } });
      } catch (orgErr) {
        console.warn("organization.status update failed (ignored):", orgErr?.message || orgErr);
      }
      return lp;
    });
    await logAction({ entityType: "ORGANIZATION", entityId: id, action: "SUSPEND", fromStatus: current.verificationStatus, toStatus: "SUSPENDED", adminUserId, note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("suspendOrgKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.commentOrgKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { comment, internalOnly } = req.body || {};
    if (!comment) return res.status(400).json({ success: false, message: 'comment is required' });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.organizationLegalProfile.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.organizationLegalProfile.update({ where: { id }, data: { reviewNote: String(comment).slice(0, 500) } });
    await addComment({ entityType: 'ORGANIZATION', entityId: id, adminUserId, comment: String(comment), internalOnly: !!internalOnly });

    return res.json({ success: true });
  } catch (e) {
    console.error('commentOrgKyc error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ---------------- Producer Orgs ----------------
exports.listProducerOrgs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const where = status ? { status } : {};
    const rows = await prisma.producerOrg.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        owner: { select: { id: true, status: true, auth: true, profile: true } },
      },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listProducerOrgs error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.producerOrg.findUnique({
      where: { id },
      include: { owner: { select: { id: true, status: true, auth: true, profile: true } } },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const logs = await prisma.verificationLog.findMany({
      where: { entityType: "PRODUCER_ORG", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ success: true, data: { ...row, logs } });
  } catch (e) {
    console.error("getProducerOrg error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.producerOrg.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    // Sync VerificationCase (PRODUCER_ORG) to APPROVED when present
    const latestCase = await prisma.verificationCase.findFirst({
      where: { entityType: "PRODUCER_ORG", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    if (latestCase && latestCase.status === "SUBMITTED") {
      await prisma.verificationCase.update({
        where: { id: latestCase.id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminUserId,
          reviewSummary: req.body?.note || null,
        },
      });
      await prisma.verificationCaseEvent.create({
        data: {
          caseId: latestCase.id,
          action: "APPROVE",
          from: latestCase.status,
          to: "APPROVED",
          actorAdminId: adminUserId,
          note: req.body?.note,
        },
      });
    }

    const updated = await prisma.producerOrg.update({
      where: { id },
      data: { status: "VERIFIED" },
    });

    await logAction({
      entityType: "PRODUCER_ORG",
      entityId: id,
      action: "APPROVE",
      fromStatus: producerStatusToVerificationStatus(current.status),
      toStatus: "VERIFIED",
      adminUserId,
      note: req.body?.note,
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveProducerOrg error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.producerOrg.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const reviewNote = note || reason;

    // Sync VerificationCase (PRODUCER_ORG) to REJECTED when present
    const latestCase = await prisma.verificationCase.findFirst({
      where: { entityType: "PRODUCER_ORG", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    if (latestCase && (latestCase.status === "SUBMITTED" || latestCase.status === "DRAFT")) {
      await prisma.verificationCase.update({
        where: { id: latestCase.id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminUserId,
          reviewSummary: reviewNote,
        },
      });
      await prisma.verificationCaseEvent.create({
        data: {
          caseId: latestCase.id,
          action: "REJECT",
          from: latestCase.status,
          to: "REJECTED",
          actorAdminId: adminUserId,
          note: reviewNote,
        },
      });
    }

    const updated = await prisma.producerOrg.update({
      where: { id },
      data: { status: "REJECTED" },
    });

    await logAction({
      entityType: "PRODUCER_ORG",
      entityId: id,
      action: "REJECT",
      fromStatus: producerStatusToVerificationStatus(current.status),
      toStatus: "REJECTED",
      adminUserId,
      note: reviewNote,
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectProducerOrg error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.requestChangesProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.producerOrg.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    // Sync VerificationCase to REJECTED so producer can create new DRAFT and resubmit
    const latestCase = await prisma.verificationCase.findFirst({
      where: { entityType: "PRODUCER_ORG", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    if (latestCase && (latestCase.status === "SUBMITTED" || latestCase.status === "DRAFT")) {
      await prisma.verificationCase.update({
        where: { id: latestCase.id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminUserId,
          reviewSummary: note || "Changes requested",
        },
      });
      await prisma.verificationCaseEvent.create({
        data: {
          caseId: latestCase.id,
          action: "REJECT",
          from: latestCase.status,
          to: "REJECTED",
          actorAdminId: adminUserId,
          note: note || "Changes requested",
        },
      });
    }

    const updated = await prisma.producerOrg.update({
      where: { id },
      data: { status: "PENDING" },
    });

    await logAction({
      entityType: "PRODUCER_ORG",
      entityId: id,
      action: "REQUEST_CHANGES",
      fromStatus: producerStatusToVerificationStatus(current.status),
      toStatus: "SUBMITTED",
      adminUserId,
      note,
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("requestChangesProducerOrg error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.suspendProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.producerOrg.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.producerOrg.update({
      where: { id },
      data: { status: "SUSPENDED" },
    });

    await logAction({
      entityType: "PRODUCER_ORG",
      entityId: id,
      action: "SUSPEND",
      fromStatus: producerStatusToVerificationStatus(current.status),
      toStatus: null,
      adminUserId,
      note,
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("suspendProducerOrg error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.commentProducerOrg = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { comment, internalOnly } = req.body || {};
    if (!comment) return res.status(400).json({ success: false, message: 'comment is required' });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.producerOrg.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });

    await addComment({ entityType: 'PRODUCER_ORG', entityId: id, adminUserId, comment: String(comment), internalOnly: !!internalOnly });
    return res.json({ success: true });
  } catch (e) {
    console.error('commentProducerOrg error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ---------------- Branches ----------------
exports.listBranchKycs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const where = status ? { verificationStatus: status } : {};
    const rows = await prisma.branchProfileDetails.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { branch: { select: { id: true, name: true, orgId: true } } },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listBranchKycs error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.branchProfileDetails.findUnique({
      where: { id },
      include: { documents: { include: { media: true } }, branch: true },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const logs = await prisma.verificationLog.findMany({
      where: { entityType: "BRANCH", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ success: true, data: { ...row, logs } });
  } catch (e) {
    console.error("getBranchKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchProfileDetails.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.branchProfileDetails.update({
        where: { id },
        data: { verificationStatus: "VERIFIED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, rejectionReason: null },
      });
      // After branch verification, move branch back to DRAFT (ready for publish request)
      try {
        await tx.branch.update({ where: { id: bp.branchId }, data: { status: "DRAFT" } });
      } catch (bErr) {
        console.warn("branch.status update failed (ignored):", bErr?.message || bErr);
      }
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "APPROVE", fromStatus: current.verificationStatus, toStatus: "VERIFIED", adminUserId, note: req.body?.note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveBranchKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchProfileDetails.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.branchProfileDetails.update({
        where: { id },
        data: { verificationStatus: "REJECTED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, rejectionReason: String(reason), reviewNote: note || null },
      });
      try {
        await tx.branch.update({ where: { id: bp.branchId }, data: { status: "DRAFT" } });
      } catch (bErr) {
        console.warn("branch.status update failed (ignored):", bErr?.message || bErr);
      }
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "REJECT", fromStatus: current.verificationStatus, toStatus: "REJECTED", adminUserId, note: note || reason });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectBranchKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.requestChangesBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchProfileDetails.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.branchProfileDetails.update({
        where: { id },
        data: { verificationStatus: "REQUEST_CHANGES", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null },
      });
      try {
        await tx.branch.update({ where: { id: bp.branchId }, data: { status: "DRAFT" } });
      } catch (bErr) {
        console.warn("branch.status update failed (ignored):", bErr?.message || bErr);
      }
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "REQUEST_CHANGES", fromStatus: current.verificationStatus, toStatus: "REQUEST_CHANGES", adminUserId, note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("requestChangesBranchKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.suspendBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchProfileDetails.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.$transaction(async (tx) => {
      const bp = await tx.branchProfileDetails.update({
        where: { id },
        data: { verificationStatus: "SUSPENDED", reviewedAt: new Date(), reviewedByAdminId: adminUserId, reviewNote: note || null },
      });
      try {
        await tx.branch.update({ where: { id: bp.branchId }, data: { status: "SUSPENDED" } });
      } catch (bErr) {
        console.warn("branch.status update failed (ignored):", bErr?.message || bErr);
      }
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "SUSPEND", fromStatus: current.verificationStatus, toStatus: "SUSPENDED", adminUserId, note });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("suspendBranchKyc error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.commentBranchKyc = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { comment, internalOnly } = req.body || {};
    if (!comment) return res.status(400).json({ success: false, message: 'comment is required' });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.branchProfileDetails.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });

    await prisma.branchProfileDetails.update({ where: { id }, data: { reviewNote: String(comment).slice(0, 500) } });
    await addComment({ entityType: 'BRANCH', entityId: id, adminUserId, comment: String(comment), internalOnly: !!internalOnly });

    return res.json({ success: true });
  } catch (e) {
    console.error('commentBranchKyc error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ---------------- Staff ----------------
// Map frontend verification statuses to MemberStatus enum values
function mapStaffStatus(status) {
  if (!status) return null;
  const s = String(status).toUpperCase().trim();
  // Map verification statuses to MemberStatus enum values
  if (s === "UNSUBMITTED" || s === "SUBMITTED" || s === "INVITED") return "INVITED";
  if (s === "VERIFIED" || s === "ACTIVE") return "ACTIVE";
  if (s === "REJECTED" || s === "SUSPENDED") return "SUSPENDED";
  // If it's already a valid enum value, return as-is
  if (["INVITED", "ACTIVE", "SUSPENDED"].includes(s)) return s;
  return null;
}

exports.listStaffVerifications = async (req, res) => {
  try {
    const status = pickStatus(req);
    const mappedStatus = mapStaffStatus(status);
    const where = mappedStatus ? { status: mappedStatus } : {};
    const rows = await prisma.branchMember.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true } },
      },
      take: 200,
    });
    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedRows = rows.map(row => ({
      ...row,
      id: row.id,
      status: row.status || "INVITED", // Ensure status is always present, default to INVITED
      userId: row.userId,
      branchId: row.branchId,
      orgId: row.orgId,
      fullName: row.user?.profile?.displayName || null,
      phone: row.user?.auth?.phone || null,
      user: row.user,
      roles: row.roles,
      branch: row.branch,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return res.json({ success: true, data: mappedRows });
  } catch (e) {
    console.error("listStaffVerifications error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    const row = await prisma.branchMember.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true, orgId: true } },
      },
    });

    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Return empty logs array for consistency with other verification endpoints
    const logs = [];

    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedRow = {
      ...row,
      id: row.id,
      status: row.status, // Explicitly include status
      userId: row.userId,
      branchId: row.branchId,
      orgId: row.orgId,
      fullName: row.user?.profile?.displayName || null,
      phone: row.user?.auth?.phone || null,
      logs,
      user: row.user,
      roles: row.roles,
      branch: row.branch,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return res.json({ success: true, data: mappedRow });
  } catch (e) {
    console.error("getStaffVerification error", e);
    console.error("Error details:", e?.message, e?.stack);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: process.env.NODE_ENV === "development" ? e?.message : undefined
    });
  }
};

exports.approveStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchMember.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: "ACTIVE", updatedAt: new Date() },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true, orgId: true } },
      },
    });

    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedData = {
      ...updated,
      id: updated.id,
      status: updated.status, // Explicitly include status
      userId: updated.userId,
      branchId: updated.branchId,
      orgId: updated.orgId,
      fullName: updated.user?.profile?.displayName || null,
      phone: updated.user?.auth?.phone || null,
      user: updated.user,
      roles: updated.roles,
      branch: updated.branch,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Skip logging for staff verifications
    // await logAction({ entityType: "STAFF", entityId: id, action: "APPROVE", fromStatus: current.status, toStatus: "ACTIVE", adminUserId, note: req.body?.note });
    return res.json({ success: true, data: mappedData });
  } catch (e) {
    console.error("approveStaffVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    const reasonOrNote = reason ?? note;
    if (!reasonOrNote) return res.status(400).json({ success: false, message: "reason or note is required" });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchMember.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    // Use SUSPENDED instead of REJECTED since REJECTED is not a valid MemberStatus enum value
    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: "SUSPENDED", updatedAt: new Date() },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true, orgId: true } },
      },
    });

    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedData = {
      ...updated,
      id: updated.id,
      status: updated.status, // Explicitly include status
      userId: updated.userId,
      branchId: updated.branchId,
      orgId: updated.orgId,
      fullName: updated.user?.profile?.displayName || null,
      phone: updated.user?.auth?.phone || null,
      user: updated.user,
      roles: updated.roles,
      branch: updated.branch,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Skip logging for staff verifications
    // await logAction({ entityType: "STAFF", entityId: id, action: "REJECT", fromStatus: current.status, toStatus: "SUSPENDED", adminUserId, note: reasonOrNote });
    return res.json({ success: true, data: mappedData });
  } catch (e) {
    console.error("rejectStaffVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.requestChangesStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    if (!note) return res.status(400).json({ success: false, message: "note is required" });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchMember.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    // For request-changes, keep status as INVITED (pending changes)
    // This allows the staff member to update their information
    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: "INVITED", updatedAt: new Date() },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true, orgId: true } },
      },
    });

    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedData = {
      ...updated,
      id: updated.id,
      status: updated.status, // Explicitly include status
      userId: updated.userId,
      branchId: updated.branchId,
      orgId: updated.orgId,
      fullName: updated.user?.profile?.displayName || null,
      phone: updated.user?.auth?.phone || null,
      user: updated.user,
      roles: updated.roles,
      branch: updated.branch,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Skip logging for staff verifications
    // await logAction({ entityType: "STAFF", entityId: id, action: "REQUEST_CHANGES", fromStatus: current.status, toStatus: "INVITED", adminUserId, note });
    return res.json({ success: true, data: mappedData });
  } catch (e) {
    console.error("requestChangesStaffVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.suspendStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.branchMember.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.branchMember.update({
      where: { id },
      data: { status: "SUSPENDED", updatedAt: new Date() },
      include: {
        user: {
          include: {
            auth: true,
            profile: true,
          }
        },
        roles: { include: { role: true } },
        branch: { select: { id: true, name: true, orgId: true } },
      },
    });

    // Map the data to include fullName from user profile
    // Explicitly include status to ensure it's always present
    const mappedData = {
      ...updated,
      id: updated.id,
      status: updated.status, // Explicitly include status
      userId: updated.userId,
      branchId: updated.branchId,
      orgId: updated.orgId,
      fullName: updated.user?.profile?.displayName || null,
      phone: updated.user?.auth?.phone || null,
      user: updated.user,
      roles: updated.roles,
      branch: updated.branch,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Skip logging for staff verifications
    // await logAction({ entityType: "STAFF", entityId: id, action: "SUSPEND", fromStatus: current.status, toStatus: "SUSPENDED", adminUserId, note });
    return res.json({ success: true, data: mappedData });
  } catch (e) {
    console.error("suspendStaffVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.commentStaffVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { comment, internalOnly } = req.body || {};
    if (!comment) return res.status(400).json({ success: false, message: 'comment is required' });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const current = await prisma.branchMember.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: 'Not found' });

    // Staff verifications don't use VerificationLog (STAFF is not in VerificationEntityType enum)
    // Skip logging comments for staff verifications
    // await addComment({ entityType: 'STAFF', entityId: id, adminUserId, comment: String(comment), internalOnly: !!internalOnly });
    return res.json({ success: true });
  } catch (e) {
    console.error('commentStaffVerification error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export {};
