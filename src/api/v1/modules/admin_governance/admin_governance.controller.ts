/**
 * Phase 3: Governance analytics — reviewer stats, compliance check.
 */

const compliance = require("../../services/governance/compliance.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** GET /admin/governance/reviewer-stats — dateFrom, dateTo, entityType (PRODUCT|BATCH|ALL). Per reviewer: reviewerId, reviewerName, assignedCount, completedCount, avgReviewTimeHours, slaBreachedCount, rejectionReasonsTop (top 5). */
exports.reviewerStats = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const dateFrom = parseDate(req.query?.dateFrom);
    const dateTo = parseDate(req.query?.dateTo);
    const entityTypeParam = req.query?.entityType ? String(req.query.entityType).toUpperCase() : "ALL";
    const entityTypeFilter = entityTypeParam === "PRODUCT" || entityTypeParam === "BATCH" ? entityTypeParam : null;

    const where: any = {};
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }
    if (entityTypeFilter) where.entityType = entityTypeFilter;

    const approvals = await prisma.producerApproval.findMany({
      where,
      select: {
        id: true,
        assignedToUserId: true,
        reviewedByUserId: true,
        assignedAt: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        slaDeadline: true,
        status: true,
        note: true,
        entityType: true,
      },
    });

    const reviewerIds = new Set<number>();
    approvals.forEach((a) => {
      if (a.assignedToUserId != null) reviewerIds.add(a.assignedToUserId);
      if (a.reviewedByUserId != null) reviewerIds.add(a.reviewedByUserId);
    });
    const userIds = [...reviewerIds];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, profile: { select: { displayName: true } } },
          })
        : [];
    const userMap = new Map(users.map((u: any) => [u.id, { id: u.id, displayName: u.profile?.displayName ?? `User ${u.id}` }]));

    type ReviewerAcc = {
      assignedCount: number;
      completedCount: number;
      reviewTimeSumHours: number;
      reviewTimeN: number;
      slaBreachedCount: number;
      rejectionReasons: Record<string, number>;
    };
    const byReviewer: Record<number, ReviewerAcc> = {};

    for (const a of approvals) {
      if (a.assignedToUserId != null) {
        if (!byReviewer[a.assignedToUserId]) {
          byReviewer[a.assignedToUserId] = { assignedCount: 0, completedCount: 0, reviewTimeSumHours: 0, reviewTimeN: 0, slaBreachedCount: 0, rejectionReasons: {} };
        }
        byReviewer[a.assignedToUserId].assignedCount += 1;
      }
      const reviewerId = a.reviewedByUserId;
      if (reviewerId != null && (a.status === "APPROVED" || a.status === "REJECTED")) {
        if (!byReviewer[reviewerId]) {
          byReviewer[reviewerId] = { assignedCount: 0, completedCount: 0, reviewTimeSumHours: 0, reviewTimeN: 0, slaBreachedCount: 0, rejectionReasons: {} };
        }
        const acc = byReviewer[reviewerId];
        acc.completedCount += 1;
        const decidedAt = a.reviewedAt ?? a.updatedAt;
        const fromAt = a.assignedAt ?? a.createdAt;
        if (decidedAt && fromAt) {
          const hours = (new Date(decidedAt).getTime() - new Date(fromAt).getTime()) / (60 * 60 * 1000);
          acc.reviewTimeSumHours += hours;
          acc.reviewTimeN += 1;
        }
        if (a.slaDeadline && decidedAt && new Date(decidedAt) > new Date(a.slaDeadline)) acc.slaBreachedCount += 1;
        if (a.status === "REJECTED" && a.note && String(a.note).trim()) {
          const reason = String(a.note).trim().slice(0, 200);
          acc.rejectionReasons[reason] = (acc.rejectionReasons[reason] ?? 0) + 1;
        }
      }
    }

    const stats = Object.entries(byReviewer).map(([userId, v]) => {
      const u = userMap.get(Number(userId));
      const rejectionReasonsTop = Object.entries(v.rejectionReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason]) => reason);
      return {
        reviewerId: Number(userId),
        reviewerName: (u as { displayName?: string })?.displayName ?? `User ${userId}`,
        assignedCount: v.assignedCount,
        completedCount: v.completedCount,
        avgReviewTimeHours: v.reviewTimeN > 0 ? Math.round((v.reviewTimeSumHours / v.reviewTimeN) * 10) / 10 : 0,
        slaBreachedCount: v.slaBreachedCount,
        rejectionReasonsTop,
      };
    });

    return res.json(successEnvelope(stats, "Reviewer stats", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

/** GET /admin/governance/compliance/product/:productId — optional query producerOrgId to scope. */
exports.productCompliance = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const producerOrgId = toInt(req.query?.producerOrgId);
    const product = await prisma.authProduct.findUnique({ where: { id: productId }, select: { producerOrgId: true } });
    if (!product) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", { productId }, getTraceId(req)));
    if (producerOrgId != null && product.producerOrgId !== producerOrgId) {
      return res.status(403).json(errorEnvelope("FORBIDDEN", "Product does not belong to the specified producer org", undefined, getTraceId(req)));
    }
    const result = await compliance.runProductComplianceChecks(prisma, productId);
    return res.json(successEnvelope(result, "Compliance checks", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

// ——— Governance Products (admin product-centric list/detail/actions) ———
const governanceProducts = require("../../services/governance/governanceProducts.service");
const auditGov = require("../../services/governance/auditGovernance.service");

const GOVERNANCE_STATUSES = ["ALL", "UNAPPROVED", "SUBMITTED", "APPROVED", "DECLINED", "REJECTED"];

/** GET /admin/governance/products — list with status, producerOrgId, q, page, limit, sortBy, sortDir. */
exports.listGovernanceProducts = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const statusParam = req.query?.status ? String(req.query.status).toUpperCase() : "ALL";
    const status = GOVERNANCE_STATUSES.includes(statusParam) ? statusParam : "ALL";
    const result = await governanceProducts.listGovernanceProducts(prisma, {
      status,
      producerOrgId: toInt(req.query?.producerOrgId),
      q: req.query?.q ? String(req.query.q) : null,
      page: toInt(req.query?.page) ?? 1,
      limit: toInt(req.query?.limit) ?? 20,
      sortBy: req.query?.sortBy === "updatedAt" || req.query?.sortBy === "name" ? req.query.sortBy : "createdAt",
      sortDir: req.query?.sortDir === "asc" ? "asc" : "desc",
    });
    return res.json(successEnvelope(result, "Governance products", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

/** GET /admin/governance/products/:id — full product detail for admin review. */
exports.getGovernanceProduct = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const detail = await governanceProducts.getGovernanceProductDetail(prisma, id);
    if (!detail) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", { productId: id }, getTraceId(req)));
    return res.json(successEnvelope(detail, "Product detail", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

/** POST /admin/governance/products/:id/actions — body: { action, note? }. Audit logged. */
exports.actOnGovernanceProduct = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const action = req.body?.action ? String(req.body.action).toUpperCase() : "";
    const validActions = ["APPROVE", "DECLINE", "REJECT", "RESET_TO_UNAPPROVED", "PUBLISH", "UNPUBLISH"];
    if (!validActions.includes(action)) {
      return res.status(400).json(errorEnvelope("INVALID_ACTION", "action must be one of: " + validActions.join(", "), undefined, getTraceId(req)));
    }
    if (action === "REJECT") {
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (note.length < 5) {
        return res.status(400).json(
          errorEnvelope("REASON_REQUIRED", "Rejection requires a note (min 5 characters)", undefined, getTraceId(req))
        );
      }
    }
    const prisma = getPrisma(req);
    const reviewedByUserId = req.user?.id ?? 0;
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : null;

    const productBefore = await prisma.authProduct.findUnique({
      where: { id },
      select: { status: true, producerOrgId: true },
    });
    if (!productBefore) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    const oldStatus = productBefore.status;

    const result = await governanceProducts.actOnGovernanceProduct(prisma, id, action, {
      note,
      reviewedByUserId,
    });

    const productAfter = await prisma.authProduct.findUnique({
      where: { id },
      select: { status: true, producerOrgId: true },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.governance.product.action",
      entityType: "AUTH_PRODUCT",
      entityId: String(id),
      orgId: productAfter?.producerOrgId ?? undefined,
      metadata: { action, oldStatus, newStatus: productAfter?.status ?? null, note: note ?? undefined },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });

    return res.json(successEnvelope(result, result.message, "UPDATED", getTraceId(req)));
  } catch (e: any) {
    if (e?.message === "NOT_FOUND") return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    if (e?.message === "NO_APPROVAL") return res.status(400).json(errorEnvelope("NO_APPROVAL", "Product has no approval record", undefined, getTraceId(req)));
    if (e?.message === "NOT_PENDING" || e?.message === "NOT_APPROVED" || e?.message === "NOT_UNDER_REVIEW" || e?.message === "NOT_ACTIVE") {
      return res.status(400).json(
        errorEnvelope("INVALID_STATE", "This product's status does not allow this action. Refresh the page to see the current state.", undefined, getTraceId(req))
      );
    }
    if (e?.message === "COMPLIANCE_FAILED") {
      return res.status(400).json(
        errorEnvelope("COMPLIANCE_FAILED", "Product compliance checks failed. Override via approvals flow if needed.", e?.details ? { compliance: e.details } : undefined, getTraceId(req))
      );
    }
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

export {};
