const prisma = require("../../../../infrastructure/db/prismaClient");
const { createNotification } = require("../../services/notification.service");
const doctorVerificationService = require("../doctor/doctorVerification.service");
const {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
  sendVerificationChangesRequestedEmail,
  sendVerificationSuspendedEmail,
} = require("../../../../common/email/verificationEmail.service");

function pickStatus(req) {
  const s = String(req.query.status || "").trim();
  if (!s) return null;
  // Backward-compatible normalization for legacy UI status values.
  if (s === "REQUEST_CHANGES" || s === "CHANGES_REQUESTED" || s === "PENDING") {
    return "SUBMITTED";
  }
  return s;
}

function pickSearch(req) {
  const s = String(req.query.search || req.query.q || "").trim();
  return s || null;
}

function pickPagination(req, defaultLimit = 50, maxLimit = 200) {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function pickDateRange(req) {
  const dateFrom = parseDateInput(req.query.dateFrom || req.query.from, false);
  const dateTo = parseDateInput(req.query.dateTo || req.query.to, true);
  return { dateFrom, dateTo };
}

function addDateRangeFilter(where, field, dateFrom, dateTo) {
  if (!field || (!dateFrom && !dateTo)) return where;
  where[field] = {};
  if (dateFrom) where[field].gte = dateFrom;
  if (dateTo) where[field].lte = dateTo;
  return where;
}

async function getUserContact(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: {
      id: true,
      auth: { select: { email: true } },
      profile: { select: { displayName: true } },
    },
  });
  if (!user) return null;
  return {
    userId: user.id,
    email: user.auth?.email || null,
    name: user.profile?.displayName || null,
  };
}

async function getOrganizationOwnerContact(orgId) {
  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: Number(orgId) },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!org?.ownerUserId) {
    return {
      userId: null,
      email: null,
      name: null,
      entityName: org?.name || null,
    };
  }
  const owner = await getUserContact(org.ownerUserId);
  return {
    userId: owner?.userId ?? org.ownerUserId,
    email: owner?.email || null,
    name: owner?.name || null,
    entityName: org?.name || null,
  };
}

async function getBranchOwnerContact(branchId) {
  if (!branchId) return null;
  const branch = await prisma.branch.findUnique({
    where: { id: Number(branchId) },
    select: { id: true, name: true, orgId: true },
  });
  if (!branch?.orgId) {
    return {
      userId: null,
      email: null,
      name: null,
      entityName: branch?.name || null,
    };
  }
  const owner = await getOrganizationOwnerContact(branch.orgId);
  return {
    userId: owner?.userId ?? null,
    email: owner?.email || null,
    name: owner?.name || null,
    entityName: branch?.name || null,
  };
}

function buildDecisionTexts(action, entityType, entityName, note) {
  const entityLabel = entityName || "your submission";
  if (action === "approve") {
    return {
      notificationType: "VERIFICATION_CASE_APPROVED",
      severity: "success",
      title: `${entityType} verification approved`,
      message: `Your ${entityType.toLowerCase()} verification for ${entityLabel} has been approved.`,
    };
  }
  if (action === "reject") {
    return {
      notificationType: "VERIFICATION_CASE_REJECTED",
      severity: "warn",
      title: `${entityType} verification rejected`,
      message: note
        ? `Your ${entityType.toLowerCase()} verification was rejected: ${note}`
        : `Your ${entityType.toLowerCase()} verification was rejected.`,
    };
  }
  if (action === "request-changes") {
    return {
      notificationType: "SYSTEM",
      severity: "warn",
      title: `${entityType} verification needs changes`,
      message: note
        ? `Changes requested for your ${entityType.toLowerCase()} verification: ${note}`
        : `Changes were requested for your ${entityType.toLowerCase()} verification.`,
    };
  }
  return {
    notificationType: "SYSTEM",
    severity: "error",
    title: `${entityType} verification suspended`,
    message: note
      ? `Your ${entityType.toLowerCase()} verification has been suspended: ${note}`
      : `Your ${entityType.toLowerCase()} verification has been suspended.`,
  };
}

async function dispatchVerificationCommunication({
  action,
  recipientUserId,
  recipientEmail,
  recipientName,
  entityType,
  entityId,
  entityName,
  note,
  actionUrl,
  source,
}) {
  const text = buildDecisionTexts(action, entityType, entityName, note);
  const dedupeKey = `verification-${action}-${entityType}-${entityId}`;

  if (recipientUserId) {
    try {
      await createNotification({
        userId: Number(recipientUserId),
        type: text.notificationType,
        title: text.title,
        message: text.message,
        meta: { entityType, entityId, action, note: note || null },
        source: source || "verification",
        actionUrl: actionUrl || "/",
        dedupeKey,
        severity: text.severity,
      });
    } catch (notifErr) {
      console.error("dispatchVerificationCommunication createNotification error", notifErr?.message || notifErr);
    }
  }

  if (!recipientEmail) return;
  try {
    const payloadBase = {
      to: recipientEmail,
      recipientName: recipientName || "User",
      entityType,
      entityName: entityName || "your profile",
      actionUrl: actionUrl || "http://localhost:3103",
    };
    if (action === "approve") {
      await sendVerificationApprovedEmail({
        ...payloadBase,
        details: note || null,
      });
      return;
    }
    if (action === "reject") {
      await sendVerificationRejectedEmail({
        ...payloadBase,
        reason: note || null,
      });
      return;
    }
    if (action === "request-changes") {
      await sendVerificationChangesRequestedEmail({
        ...payloadBase,
        notes: note || null,
      });
      return;
    }
    await sendVerificationSuspendedEmail({
      ...payloadBase,
      reason: note || null,
    });
  } catch (mailErr) {
    console.error("dispatchVerificationCommunication email error", mailErr?.message || mailErr);
  }
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

exports.getVerificationStats = async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const [
      ownerTotal,
      ownerPending,
      ownerApprovedToday,
      ownerRejectedToday,
      orgTotal,
      orgPending,
      orgApprovedToday,
      orgRejectedToday,
      branchTotal,
      branchPending,
      branchApprovedToday,
      branchRejectedToday,
      staffTotal,
      staffPending,
      staffApprovedToday,
      staffRejectedToday,
      producerTotal,
      producerPending,
      producerApprovedToday,
      producerRejectedToday,
      doctorTotal,
      doctorPending,
      doctorApprovedToday,
      doctorRejectedToday,
      recentActivity,
    ] = await Promise.all([
      prisma.ownerKyc.count(),
      prisma.ownerKyc.count({ where: { verificationStatus: "SUBMITTED" } }),
      prisma.ownerKyc.count({ where: { verificationStatus: "VERIFIED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.ownerKyc.count({ where: { verificationStatus: "REJECTED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.organizationLegalProfile.count(),
      prisma.organizationLegalProfile.count({ where: { verificationStatus: "SUBMITTED" } }),
      prisma.organizationLegalProfile.count({ where: { verificationStatus: "VERIFIED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.organizationLegalProfile.count({ where: { verificationStatus: "REJECTED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.branchProfileDetails.count(),
      prisma.branchProfileDetails.count({ where: { verificationStatus: "SUBMITTED" } }),
      prisma.branchProfileDetails.count({ where: { verificationStatus: "VERIFIED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.branchProfileDetails.count({ where: { verificationStatus: "REJECTED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.branchMember.count(),
      prisma.branchMember.count({ where: { status: "INVITED" } }),
      prisma.branchMember.count({ where: { status: "ACTIVE", updatedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.branchMember.count({ where: { status: "SUSPENDED", updatedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.producerOrg.count(),
      prisma.producerOrg.count({ where: { status: "PENDING" } }),
      prisma.producerOrg.count({ where: { status: "VERIFIED", updatedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.producerOrg.count({ where: { status: "REJECTED", updatedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.doctorVerification.count(),
      prisma.doctorVerification.count({ where: { verificationStatus: "SUBMITTED" } }),
      prisma.doctorVerification.count({ where: { verificationStatus: "VERIFIED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.doctorVerification.count({ where: { verificationStatus: "REJECTED", reviewedAt: { gte: dayStart, lte: dayEnd } } }),

      prisma.verificationLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    const entities = {
      owners: {
        key: "owners",
        label: "Owners",
        total: ownerTotal,
        pending: ownerPending,
        approvedToday: ownerApprovedToday,
        rejectedToday: ownerRejectedToday,
      },
      organizations: {
        key: "organizations",
        label: "Organizations",
        total: orgTotal,
        pending: orgPending,
        approvedToday: orgApprovedToday,
        rejectedToday: orgRejectedToday,
      },
      branches: {
        key: "branches",
        label: "Branches",
        total: branchTotal,
        pending: branchPending,
        approvedToday: branchApprovedToday,
        rejectedToday: branchRejectedToday,
      },
      staff: {
        key: "staff",
        label: "Staff",
        total: staffTotal,
        pending: staffPending,
        approvedToday: staffApprovedToday,
        rejectedToday: staffRejectedToday,
      },
      producer_orgs: {
        key: "producer_orgs",
        label: "Producers",
        total: producerTotal,
        pending: producerPending,
        approvedToday: producerApprovedToday,
        rejectedToday: producerRejectedToday,
      },
      doctors: {
        key: "doctors",
        label: "Doctors",
        total: doctorTotal,
        pending: doctorPending,
        approvedToday: doctorApprovedToday,
        rejectedToday: doctorRejectedToday,
      },
    };

    const totals = Object.values(entities).reduce(
      (acc, item) => {
        acc.total += item.total;
        acc.pending += item.pending;
        acc.approvedToday += item.approvedToday;
        acc.rejectedToday += item.rejectedToday;
        return acc;
      },
      { total: 0, pending: 0, approvedToday: 0, rejectedToday: 0 }
    );

    return res.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        totals,
        entities,
        recentActivity,
      },
    });
  } catch (e) {
    console.error("getVerificationStats error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ---------------- Owners ----------------
exports.listOwnerKycs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const search = pickSearch(req);
    const { limit, offset } = pickPagination(req);
    const { dateFrom, dateTo } = pickDateRange(req);
    const where = {} as any;
    if (status) where.verificationStatus = status;
    addDateRangeFilter(where, "submittedAt", dateFrom, dateTo);

    if (search) {
      const numericSearch = Number(search);
      const or = [] as any[];
      or.push({ fullName: { contains: search, mode: "insensitive" } });
      or.push({ mobile: { contains: search, mode: "insensitive" } });
      or.push({ email: { contains: search, mode: "insensitive" } });
      or.push({ nidNumber: { contains: search, mode: "insensitive" } });
      or.push({ user: { is: { auth: { is: { phone: { contains: search, mode: "insensitive" } } } } } });
      or.push({ user: { is: { auth: { is: { email: { contains: search, mode: "insensitive" } } } } } });
      if (Number.isFinite(numericSearch)) {
        or.push({ id: Number(numericSearch) });
        or.push({ userId: Number(numericSearch) });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.ownerKyc.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { user: { select: { id: true, status: true, auth: true } } },
        take: limit,
        skip: offset,
      }),
      prisma.ownerKyc.count({ where }),
    ]);
    return res.json({ success: true, data: rows, total, limit, offset });
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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Owner",
      entityId: id,
      entityName: current.fullName || "Owner profile",
      note: req.body?.note || null,
      actionUrl: "/owner/kyc",
      source: "owner_kyc",
    });

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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Owner",
      entityId: id,
      entityName: current.fullName || "Owner profile",
      note: note || reason,
      actionUrl: "/owner/kyc",
      source: "owner_kyc",
    });

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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "request-changes",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Owner",
      entityId: id,
      entityName: current.fullName || "Owner profile",
      note: note || "Please review your submission and resubmit.",
      actionUrl: "/owner/kyc",
      source: "owner_kyc",
    });

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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "suspend",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Owner",
      entityId: id,
      entityName: current.fullName || "Owner profile",
      note: note || "Suspended by admin.",
      actionUrl: "/owner/kyc",
      source: "owner_kyc",
    });

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
    const search = pickSearch(req);
    const { limit, offset } = pickPagination(req);
    const { dateFrom, dateTo } = pickDateRange(req);
    const where = {} as any;
    if (status) where.verificationStatus = status;
    addDateRangeFilter(where, "submittedAt", dateFrom, dateTo);

    if (search) {
      const numericSearch = Number(search);
      const or = [] as any[];
      or.push({ organizationName: { contains: search, mode: "insensitive" } });
      or.push({ tradeLicenseNumber: { contains: search, mode: "insensitive" } });
      or.push({ tinNumber: { contains: search, mode: "insensitive" } });
      or.push({ binNumber: { contains: search, mode: "insensitive" } });
      or.push({ organization: { is: { name: { contains: search, mode: "insensitive" } } } });
      if (Number.isFinite(numericSearch)) {
        or.push({ id: Number(numericSearch) });
        or.push({ orgId: Number(numericSearch) });
        or.push({ organization: { is: { ownerUserId: Number(numericSearch) } } });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.organizationLegalProfile.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { organization: { select: { id: true, name: true, ownerUserId: true, status: true } } },
        take: limit,
        skip: offset,
      }),
      prisma.organizationLegalProfile.count({ where }),
    ]);
    return res.json({ success: true, data: rows, total, limit, offset });
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
    const recipient = await getOrganizationOwnerContact(current.orgId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Organization",
      entityId: id,
      entityName: current.organizationName || recipient?.entityName || `Organization #${current.orgId}`,
      note: req.body?.note || null,
      actionUrl: "/owner/organizations",
      source: "organization_kyc",
    });
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
    const recipient = await getOrganizationOwnerContact(current.orgId);
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Organization",
      entityId: id,
      entityName: current.organizationName || recipient?.entityName || `Organization #${current.orgId}`,
      note: note || reason,
      actionUrl: "/owner/organizations",
      source: "organization_kyc",
    });
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
    const recipient = await getOrganizationOwnerContact(current.orgId);
    await dispatchVerificationCommunication({
      action: "request-changes",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Organization",
      entityId: id,
      entityName: current.organizationName || recipient?.entityName || `Organization #${current.orgId}`,
      note: note || "Please update and resubmit the legal profile.",
      actionUrl: "/owner/organizations",
      source: "organization_kyc",
    });
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
    const recipient = await getOrganizationOwnerContact(current.orgId);
    await dispatchVerificationCommunication({
      action: "suspend",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Organization",
      entityId: id,
      entityName: current.organizationName || recipient?.entityName || `Organization #${current.orgId}`,
      note: note || "Suspended by admin.",
      actionUrl: "/owner/organizations",
      source: "organization_kyc",
    });
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
    const search = pickSearch(req);
    const { limit, offset } = pickPagination(req);
    const { dateFrom, dateTo } = pickDateRange(req);
    const where = {} as any;
    if (status) where.status = status;
    addDateRangeFilter(where, "createdAt", dateFrom, dateTo);

    if (search) {
      const numericSearch = Number(search);
      const or = [] as any[];
      or.push({ name: { contains: search, mode: "insensitive" } });
      or.push({ countryCode: { contains: search, mode: "insensitive" } });
      or.push({ owner: { is: { auth: { is: { email: { contains: search, mode: "insensitive" } } } } } });
      or.push({ owner: { is: { auth: { is: { phone: { contains: search, mode: "insensitive" } } } } } });
      or.push({ owner: { is: { profile: { is: { displayName: { contains: search, mode: "insensitive" } } } } } });
      if (Number.isFinite(numericSearch)) {
        or.push({ id: Number(numericSearch) });
        or.push({ ownerUserId: Number(numericSearch) });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.producerOrg.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          owner: { select: { id: true, status: true, auth: true, profile: true } },
        },
        take: limit,
        skip: offset,
      }),
      prisma.producerOrg.count({ where }),
    ]);
    return res.json({ success: true, data: rows, total, limit, offset });
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
    const recipient = await getUserContact(current.ownerUserId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: recipient?.userId ?? current.ownerUserId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Producer Organization",
      entityId: id,
      entityName: current.name || `Producer Org #${id}`,
      note: req.body?.note || null,
      actionUrl: "/producer/kyc",
      source: "producer",
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
    const recipient = await getUserContact(current.ownerUserId);
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: recipient?.userId ?? current.ownerUserId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Producer Organization",
      entityId: id,
      entityName: current.name || `Producer Org #${id}`,
      note: reviewNote,
      actionUrl: "/producer/kyc",
      source: "producer",
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
    const recipient = await getUserContact(current.ownerUserId);
    await dispatchVerificationCommunication({
      action: "request-changes",
      recipientUserId: recipient?.userId ?? current.ownerUserId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Producer Organization",
      entityId: id,
      entityName: current.name || `Producer Org #${id}`,
      note: note || "Please update your producer profile and resubmit.",
      actionUrl: "/producer/kyc",
      source: "producer",
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
    const recipient = await getUserContact(current.ownerUserId);
    await dispatchVerificationCommunication({
      action: "suspend",
      recipientUserId: recipient?.userId ?? current.ownerUserId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Producer Organization",
      entityId: id,
      entityName: current.name || `Producer Org #${id}`,
      note: note || "Suspended by admin.",
      actionUrl: "/producer/kyc",
      source: "producer",
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

// ---------------- Producer Products (Auth Product queue: UNDER_REVIEW → ACTIVE by platform admin) ----------------
exports.listProducerProducts = async (req, res) => {
  try {
    const status = pickStatus(req);
    const where = status ? { status } : { status: "UNDER_REVIEW" };
    const rows = await prisma.authProduct.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      include: {
        producerOrg: { select: { id: true, name: true, status: true } },
        factory: { select: { id: true, name: true } },
      },
      take: 200,
    });
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listProducerProducts error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getProducerProduct = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.authProduct.findUnique({
      where: { id },
      include: {
        producerOrg: { select: { id: true, name: true, status: true } },
        factory: { select: { id: true, name: true } },
        proofs: { include: { media: { select: { id: true, url: true, type: true, mimeType: true } } } },
      },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("getProducerProduct error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveProducerProduct = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.authProduct.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });
    if (current.status !== "UNDER_REVIEW") {
      return res.status(400).json({ success: false, message: "Product is not under platform review" });
    }

    const updated = await prisma.authProduct.update({
      where: { id },
      data: {
        status: "ACTIVE",
        reviewedAt: new Date(),
        reviewedByAdminId: adminUserId,
        reviewNotes: req.body?.note || null,
      },
    });
    await logAction({
      entityType: "PRODUCER_PRODUCT",
      entityId: id,
      action: "APPROVE",
      fromStatus: "SUBMITTED",
      toStatus: "VERIFIED",
      adminUserId,
      note: req.body?.note,
    });
    try {
      const org = await prisma.producerOrg.findUnique({
        where: { id: current.producerOrgId },
        select: { ownerUserId: true, name: true },
      });
      if (org?.ownerUserId) {
        const recipient = await getUserContact(org.ownerUserId);
        await dispatchVerificationCommunication({
          action: "approve",
          recipientUserId: recipient?.userId ?? org.ownerUserId,
          recipientEmail: recipient?.email,
          recipientName: recipient?.name,
          entityType: "Producer Product",
          entityId: id,
          entityName: `Product #${id} (${org.name || "Producer"})`,
          note: req.body?.note || null,
          actionUrl: `/producer/products/${id}`,
          source: "producer",
        });
      }
    } catch (notifErr) {
      console.error("approveProducerProduct notification error", notifErr?.message || notifErr);
    }
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveProducerProduct error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectProducerProduct = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { reason, note } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await prisma.authProduct.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });
    if (current.status !== "UNDER_REVIEW") {
      return res.status(400).json({ success: false, message: "Product is not under platform review" });
    }

    const reviewNote = note || reason;
    const updated = await prisma.authProduct.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedByAdminId: adminUserId,
        reviewNotes: reviewNote,
      },
    });
    await logAction({
      entityType: "PRODUCER_PRODUCT",
      entityId: id,
      action: "REJECT",
      fromStatus: "SUBMITTED",
      toStatus: "REJECTED",
      adminUserId,
      note: reviewNote,
    });
    try {
      const org = await prisma.producerOrg.findUnique({
        where: { id: current.producerOrgId },
        select: { ownerUserId: true, name: true },
      });
      if (org?.ownerUserId) {
        const recipient = await getUserContact(org.ownerUserId);
        await dispatchVerificationCommunication({
          action: "reject",
          recipientUserId: recipient?.userId ?? org.ownerUserId,
          recipientEmail: recipient?.email,
          recipientName: recipient?.name,
          entityType: "Producer Product",
          entityId: id,
          entityName: `Product #${id} (${org.name || "Producer"})`,
          note: reviewNote,
          actionUrl: `/producer/products/${id}`,
          source: "producer",
        });
      }
    } catch (notifErr) {
      console.error("rejectProducerProduct notification error", notifErr?.message || notifErr);
    }
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectProducerProduct error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

// ---------------- Branches ----------------
exports.listBranchKycs = async (req, res) => {
  try {
    const status = pickStatus(req);
    const search = pickSearch(req);
    const { limit, offset } = pickPagination(req);
    const { dateFrom, dateTo } = pickDateRange(req);
    const where = {} as any;
    if (status) where.verificationStatus = status;
    addDateRangeFilter(where, "submittedAt", dateFrom, dateTo);

    if (search) {
      const numericSearch = Number(search);
      const or = [] as any[];
      or.push({ managerName: { contains: search, mode: "insensitive" } });
      or.push({ branch: { is: { name: { contains: search, mode: "insensitive" } } } });
      if (Number.isFinite(numericSearch)) {
        or.push({ id: Number(numericSearch) });
        or.push({ branchId: Number(numericSearch) });
        or.push({ branch: { is: { orgId: Number(numericSearch) } } });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.branchProfileDetails.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          branch: {
            select: { id: true, name: true, orgId: true, status: true, verificationStatus: true },
          },
        },
        take: limit,
        skip: offset,
      }),
      prisma.branchProfileDetails.count({ where }),
    ]);
    return res.json({ success: true, data: rows, total, limit, offset });
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
      // Sync Branch row so owner panel and clinic flows see ACTIVE + VERIFIED (single source of truth).
      await tx.branch.update({
        where: { id: bp.branchId },
        data: { status: "ACTIVE", verificationStatus: "VERIFIED" },
      });
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "APPROVE", fromStatus: current.verificationStatus, toStatus: "VERIFIED", adminUserId, note: req.body?.note });
    const recipient = await getBranchOwnerContact(current.branchId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Branch",
      entityId: id,
      entityName: recipient?.entityName || `Branch #${current.branchId}`,
      note: req.body?.note || null,
      actionUrl: "/owner/branches",
      source: "branch_kyc",
    });
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
      await tx.branch.update({
        where: { id: bp.branchId },
        data: { status: "DRAFT", verificationStatus: "REJECTED" },
      });
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "REJECT", fromStatus: current.verificationStatus, toStatus: "REJECTED", adminUserId, note: note || reason });
    const recipient = await getBranchOwnerContact(current.branchId);
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Branch",
      entityId: id,
      entityName: recipient?.entityName || `Branch #${current.branchId}`,
      note: note || reason,
      actionUrl: "/owner/branches",
      source: "branch_kyc",
    });
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
      await tx.branch.update({
        where: { id: bp.branchId },
        data: { status: "DRAFT" },
      });
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "REQUEST_CHANGES", fromStatus: current.verificationStatus, toStatus: "REQUEST_CHANGES", adminUserId, note });
    const recipient = await getBranchOwnerContact(current.branchId);
    await dispatchVerificationCommunication({
      action: "request-changes",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Branch",
      entityId: id,
      entityName: recipient?.entityName || `Branch #${current.branchId}`,
      note: note || "Please correct branch documents and resubmit.",
      actionUrl: "/owner/branches",
      source: "branch_kyc",
    });
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
      // BranchStatus enum has no SUSPENDED; use BLOCKED so branch is not operational for appointments/clinic.
      await tx.branch.update({
        where: { id: bp.branchId },
        data: { status: "BLOCKED" },
      });
      return bp;
    });
    await logAction({ entityType: "BRANCH", entityId: id, action: "SUSPEND", fromStatus: current.verificationStatus, toStatus: "SUSPENDED", adminUserId, note });
    const recipient = await getBranchOwnerContact(current.branchId);
    await dispatchVerificationCommunication({
      action: "suspend",
      recipientUserId: recipient?.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Branch",
      entityId: id,
      entityName: recipient?.entityName || `Branch #${current.branchId}`,
      note: note || "Suspended by admin.",
      actionUrl: "/owner/branches",
      source: "branch_kyc",
    });
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
    const search = pickSearch(req);
    const { limit, offset } = pickPagination(req);
    const { dateFrom, dateTo } = pickDateRange(req);
    const mappedStatus = mapStaffStatus(status);
    const where = {} as any;
    if (mappedStatus) where.status = mappedStatus;
    addDateRangeFilter(where, "createdAt", dateFrom, dateTo);
    if (search) {
      const numericSearch = Number(search);
      const or = [] as any[];
      or.push({ user: { is: { auth: { is: { email: { contains: search, mode: "insensitive" } } } } } });
      or.push({ user: { is: { auth: { is: { phone: { contains: search, mode: "insensitive" } } } } } });
      or.push({ user: { is: { profile: { is: { displayName: { contains: search, mode: "insensitive" } } } } } });
      or.push({ branch: { is: { name: { contains: search, mode: "insensitive" } } } });
      if (Number.isFinite(numericSearch)) {
        or.push({ id: Number(numericSearch) });
        or.push({ userId: Number(numericSearch) });
        or.push({ branchId: Number(numericSearch) });
      }
      where.OR = or;
    }
    const [rows, total] = await Promise.all([
      prisma.branchMember.findMany({
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
        take: limit,
        skip: offset,
      }),
      prisma.branchMember.count({ where }),
    ]);
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
    return res.json({ success: true, data: mappedRows, total, limit, offset });
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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: recipient?.userId ?? current.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Staff",
      entityId: id,
      entityName: mappedData.fullName || `Staff #${id}`,
      note: req.body?.note || null,
      actionUrl: "/staff",
      source: "staff_verification",
    });
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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: recipient?.userId ?? current.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Staff",
      entityId: id,
      entityName: mappedData.fullName || `Staff #${id}`,
      note: reasonOrNote,
      actionUrl: "/staff",
      source: "staff_verification",
    });
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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "request-changes",
      recipientUserId: recipient?.userId ?? current.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Staff",
      entityId: id,
      entityName: mappedData.fullName || `Staff #${id}`,
      note: note,
      actionUrl: "/staff",
      source: "staff_verification",
    });
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
    const recipient = await getUserContact(current.userId);
    await dispatchVerificationCommunication({
      action: "suspend",
      recipientUserId: recipient?.userId ?? current.userId,
      recipientEmail: recipient?.email,
      recipientName: recipient?.name,
      entityType: "Staff",
      entityId: id,
      entityName: mappedData.fullName || `Staff #${id}`,
      note: note || "Suspended by admin.",
      actionUrl: "/staff",
      source: "staff_verification",
    });
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

// ---------- Doctor verification (clinic doctor KYC) ----------
exports.listDoctorVerifications = async (req, res) => {
  try {
    const status = pickStatus(req);
    const search = pickSearch(req);
    const country = String(req.query.country || "").trim() || undefined;
    const bodyId = req.query.bodyId != null && Number.isFinite(Number(req.query.bodyId)) ? Number(req.query.bodyId) : undefined;
    const { dateFrom, dateTo } = pickDateRange(req);
    const { limit, offset } = pickPagination(req, 100, 200);
    const result = await doctorVerificationService.listForAdmin({
      status: status || undefined,
      search: search || undefined,
      country,
      bodyId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit,
      offset,
    });
    return res.json({ success: true, data: result.rows, total: result.total, limit, offset });
  } catch (e) {
    console.error("listDoctorVerifications error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

function addSignedUrlForDoc(d, adminUserId) {
  const baseUrl =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  const jwt = require("jsonwebtoken");
  const appConfig = require("../../../../config/appConfig");
  const key = d.fileUrl || null;
  if (!key) return { ...d, url: null };
  const token = jwt.sign(
    { purpose: "FILE_VIEW", fileKey: key, userId: adminUserId },
    appConfig.jwt.secret,
    { expiresIn: "20m" }
  );
  return { ...d, url: `${baseUrl}/api/v1/files/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}` };
}

function addSignedUrlsForAdminDocs(row, adminUserId) {
  let out = { ...row };
  if (row?.documents?.length) {
    out.documents = row.documents.map((d) => addSignedUrlForDoc(d, adminUserId));
  }
  if (row?.licenses?.length) {
    out.licenses = row.licenses.map((lic) => ({
      ...lic,
      documents: (lic.documents || []).map((d) => addSignedUrlForDoc(d, adminUserId)),
    }));
  }
  return out;
}

exports.getDoctorVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await doctorVerificationService.getByIdForAdmin(id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || 0;
    const out = addSignedUrlsForAdminDocs(row, adminUserId);
    return res.json({ success: true, data: out });
  } catch (e) {
    console.error("getDoctorVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.approveDoctorVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await doctorVerificationService.getByIdForAdmin(id);
    if (!current) return res.status(404).json({ success: false, message: "Not found" });
    if (current.verificationStatus !== "SUBMITTED")
      return res.status(400).json({
        success: false,
        message: "Only SUBMITTED verifications can be approved",
      });
    const updated = await doctorVerificationService.approve(id, adminUserId);
    await dispatchVerificationCommunication({
      action: "approve",
      recipientUserId: current.userId,
      recipientEmail: current.user?.auth?.email || null,
      recipientName: current.user?.auth?.name || null,
      entityType: "Doctor",
      entityId: id,
      entityName: `Doctor verification #${id}`,
      note: req.body?.note || null,
      actionUrl: "/doctor/verification",
      source: "doctor_verification",
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("approveDoctorVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.rejectDoctorVerification = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const { note } = req.body || {};
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const current = await doctorVerificationService.getByIdForAdmin(id);
    if (!current) return res.status(404).json({ success: false, message: "Not found" });
    if (current.verificationStatus !== "SUBMITTED")
      return res.status(400).json({
        success: false,
        message: "Only SUBMITTED verifications can be rejected",
      });
    const updated = await doctorVerificationService.reject(
      id,
      adminUserId,
      note != null ? String(note) : ""
    );
    await dispatchVerificationCommunication({
      action: "reject",
      recipientUserId: current.userId,
      recipientEmail: current.user?.auth?.email || null,
      recipientName: current.user?.auth?.name || null,
      entityType: "Doctor",
      entityId: id,
      entityName: `Doctor verification #${id}`,
      note: note != null ? String(note) : "",
      actionUrl: "/doctor/verification",
      source: "doctor_verification",
    });
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("rejectDoctorVerification error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
