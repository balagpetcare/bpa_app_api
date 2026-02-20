import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function resolveRecipientUserId(entityType, entityId) {
  try {
    if (!entityType || entityId === null || entityId === undefined) return null;

    if (entityType === "OWNER") return Number(entityId);

    if (entityType === "ORGANIZATION") {
      const org = await prisma.organization.findUnique({
        where: { id: Number(entityId) },
        select: { ownerUserId: true },
      });
      return org?.ownerUserId ? Number(org.ownerUserId) : null;
    }

    if (entityType === "BRANCH") {
      const branch = await prisma.branch.findUnique({
        where: { id: Number(entityId) },
        select: { org: { select: { ownerUserId: true } } },
      });
      return branch?.org?.ownerUserId ? Number(branch.org.ownerUserId) : null;
    }

    if (entityType === "PRODUCER_ORG") {
      const po = await prisma.producerOrg.findUnique({
        where: { id: Number(entityId) },
        select: { ownerUserId: true },
      });
      return po?.ownerUserId ? Number(po.ownerUserId) : null;
    }

    return null;
  } catch (e) {
    console.warn("resolveRecipientUserId failed:", e?.message || e);
    return null;
  }
}

async function createNotification({ userId, type, title, message, meta }) {
  if (!userId) return;
  try {
    await prisma.notification.create({
      data: {
        userId: Number(userId),
        type,
        title: String(title || "Notification"),
        message: String(message || ""),
        meta: meta || undefined,
      },
    });
  } catch (e) {
    console.warn("notification.create failed:", e?.message || e);
  }
}

async function addEvent({ caseId, action, from, to, actorAdminId, note }) {
  try {
    await prisma.verificationCaseEvent.create({
      data: {
        caseId: Number(caseId),
        action,
        from: from || null,
        to: to || null,
        actorAdminId: actorAdminId ? Number(actorAdminId) : null,
        note: note || null,
      },
    });
  } catch (e) {
    console.warn("verificationCaseEvent.create failed:", e?.message || e);
  }
}

exports.listCases = async (req, res) => {
  try {
    const status = (req.query.status || "").toString().trim();
    const entityType = (req.query.entityType || "").toString().trim();
    const entityId = toInt(req.query.entityId);

    // ✅ FIX: typed where
    const where: Prisma.VerificationCaseWhereInput = {};

    if (status) where.status = status;
    if (entityType) where.entityType = entityType;

    // ✅ FIX: entityId = 0 হলে যেন বাদ না যায়
    if (entityId !== null) where.entityId = entityId;

    const rows = await prisma.verificationCase.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { documents: true, events: true } },
      },
      take: 200,
    });

    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("listCases error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};


exports.getCase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.verificationCase.findUnique({
      where: { id },
      include: {
        documents: { include: { media: true, checkedByAdmin: { select: { id: true } } } },
        events: { orderBy: { createdAt: "desc" }, take: 200, include: { actorAdmin: { select: { id: true } } } },
        reviewedByAdmin: { select: { id: true } },
      },
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    console.error("getCase error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.patchDocument = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;

    const { status, rejectReason, instruction } = req.body || {};
    if (!status) return res.status(400).json({ success: false, message: "status is required" });

    const current = await prisma.verificationDocument.findUnique({
      where: { id },
      include: { verificationCase: true },
    });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.verificationDocument.update({
      where: { id },
      data: {
        status,
        rejectReason: rejectReason ?? null,
        instruction: instruction ?? null,
        checkedAt: new Date(),
        checkedByAdminId: adminUserId,
      },
      include: { media: true },
    });

    // Notify owner (best-effort)
    const recipientUserId = await resolveRecipientUserId(current.verificationCase.entityType, current.verificationCase.entityId);
    if (status === "REJECTED") {
      await createNotification({
        userId: recipientUserId,
        type: "VERIFICATION_DOCUMENT_REJECTED",
        title: "Document needs changes",
        message: instruction || rejectReason || "Please update and resubmit the document.",
        meta: { caseId: current.caseId, documentId: id, docType: current.docType },
      });
    } else if (status === "APPROVED") {
      await createNotification({
        userId: recipientUserId,
        type: "VERIFICATION_DOCUMENT_APPROVED",
        title: "Document approved",
        message: `Your ${current.docType} document has been approved.`,
        meta: { caseId: current.caseId, documentId: id, docType: current.docType },
      });
    }

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("patchDocument error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/** Sync entity status when VerificationCase is APPROVED (per platform policy) */
async function syncEntityStatusOnApproval(entityType, entityId, adminUserId) {
  try {
    if (entityType === "PRODUCER_ORG") {
      await prisma.producerOrg.update({
        where: { id: Number(entityId) },
        data: { status: "VERIFIED" },
      });
    } else if (entityType === "OWNER") {
      await prisma.ownerKyc.updateMany({
        where: { userId: Number(entityId) },
        data: { verificationStatus: "VERIFIED", reviewedAt: new Date(), reviewedByAdminId: adminUserId },
      });
    } else if (entityType === "ORGANIZATION") {
      const lp = await prisma.organizationLegalProfile.findFirst({ where: { orgId: Number(entityId) }, select: { id: true } });
      if (lp) {
        await prisma.organizationLegalProfile.update({
          where: { id: lp.id },
          data: { verificationStatus: "VERIFIED", reviewedAt: new Date() },
        });
        await prisma.organization.update({ where: { id: Number(entityId) }, data: { status: "APPROVED" } }).catch(() => null);
      }
    } else if (entityType === "BRANCH") {
      const bp = await prisma.branchProfileDetails.findFirst({ where: { branchId: Number(entityId) }, select: { id: true } });
      if (bp) {
        await prisma.branchProfileDetails.update({
          where: { id: bp.id },
          data: { verificationStatus: "VERIFIED", reviewedAt: new Date() },
        });
        await prisma.branch.update({ where: { id: Number(entityId) }, data: { status: "DRAFT" } }).catch(() => null);
      }
    }
  } catch (e) {
    console.warn("syncEntityStatusOnApproval failed:", e?.message || e);
  }
}

exports.decideCase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const adminUserId = Number(req.user?.id || req.admin?.id || 0) || null;
    const { status, reviewSummary } = req.body || {};

    if (!status || !["APPROVED", "REJECTED"].includes(String(status))) {
      return res.status(400).json({ success: false, message: "status must be APPROVED or REJECTED" });
    }

    const current = await prisma.verificationCase.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Not found" });

    const updated = await prisma.verificationCase.update({
      where: { id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedByAdminId: adminUserId,
        reviewSummary: reviewSummary ?? null,
      },
    });

    if (status === "APPROVED") {
      await syncEntityStatusOnApproval(current.entityType, current.entityId, adminUserId);
    }

    await addEvent({
      caseId: id,
      action: status === "APPROVED" ? "APPROVE" : "REJECT",
      from: current.status,
      to: status,
      actorAdminId: adminUserId,
      note: reviewSummary || null,
    });

    // Notify owner (best-effort)
    const recipientUserId = await resolveRecipientUserId(current.entityType, current.entityId);
    if (status === "APPROVED") {
      await createNotification({
        userId: recipientUserId,
        type: "VERIFICATION_CASE_APPROVED",
        title: "Verification approved",
        message: reviewSummary || "Your verification has been approved.",
        meta: { caseId: id, entityType: current.entityType, entityId: current.entityId },
      });
    } else {
      await createNotification({
        userId: recipientUserId,
        type: "VERIFICATION_CASE_REJECTED",
        title: "Verification needs changes",
        message: reviewSummary || "Please update the requested information and resubmit.",
        meta: { caseId: id, entityType: current.entityType, entityId: current.entityId },
      });
    }

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("decideCase error", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
