/**
 * Admin approval queue: list pending ProducerApprovals (SUBMITTED) and platform-review products (APPROVED + UNDER_REVIEW).
 * Supports filtering, search, pagination. Detail view and producer notifications.
 */

const producerApproval = require("../producer/producerApproval.service");
const compliance = require("../../services/governance/compliance.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");
const auditGov = require("../../services/governance/auditGovernance.service");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** stage: submitted = only SUBMITTED approvals; under_review = only APPROVED+PRODUCT+UNDER_REVIEW; all = both (default) */
function parseStage(q: any): "submitted" | "under_review" | "all" {
  const s = String(q?.stage ?? "all").toLowerCase();
  if (s === "submitted" || s === "under_review") return s;
  return "all";
}

/**
 * Notify producer org owner when a product approval is approved or rejected (stored in DB).
 */
async function notifyProducerApprovalResult(prisma: any, params: {
  producerOrgId: number;
  productId: number;
  productName: string;
  approved: boolean;
  reason?: string | null;
}, senderUserId: number) {
  const org = await prisma.producerOrg.findUnique({
    where: { id: params.producerOrgId },
    select: { ownerUserId: true },
  });
  if (!org?.ownerUserId) return;
  const { createNotification } = require("../../services/notification.service");
  const type = params.approved ? "PRODUCT_APPROVED" : "PRODUCT_REJECTED";
  const title = params.approved
    ? "Product approved"
    : "Product rejected";
  const message = params.approved
    ? `Your product "${params.productName}" has been approved.`
    : `Your product "${params.productName}" was rejected${params.reason ? `: ${params.reason}` : "."}`;
  const actionUrl = `/producer/products/${params.productId}`;
  await createNotification({
    userId: org.ownerUserId,
    type: type as any,
    title,
    message,
    actionUrl,
    meta: { entityType: "PRODUCT", entityId: params.productId },
    source: "producer",
    orgId: params.producerOrgId,
    severity: params.approved ? "success" : "warn",
    senderId: senderUserId,
    dedupeKey: `approval_${params.producerOrgId}_${params.productId}_${params.approved ? "ok" : "rej"}_${Date.now()}`,
  });
}

exports.getDetail = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findUnique({
      where: { id },
      include: {
        producerOrg: { select: { id: true, name: true, ownerUserId: true } },
      },
    });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));

    let product = null;
    let batch = null;
    if (approval.entityType === "PRODUCT") {
      product = await prisma.authProduct.findUnique({
        where: { id: approval.entityId },
        include: {
          proofs: { include: { media: { select: { id: true, url: true } } } },
        },
      });
    } else {
      batch = await prisma.authBatch.findUnique({
        where: { id: approval.entityId },
        include: {
          authProduct: {
            include: {
              proofs: { include: { media: { select: { id: true, url: true } } } },
            },
          },
        },
      });
    }

    const submittedBy = approval.submittedByUserId
      ? await prisma.user.findUnique({
          where: { id: approval.submittedByUserId },
          select: { id: true, profile: { select: { displayName: true } } },
        })
      : null;

    let revisionHistory: { id: number; revisionNumber: number; submittedByUserId: number; approvalId: number | null; createdAt: Date }[] = [];
    if (approval.entityType === "PRODUCT" && product) {
      const productRevision = require("../../services/governance/productRevision.service");
      revisionHistory = await productRevision.getRevisionHistory(prisma, product.id);
    }

    const payload = {
      approval: {
        id: approval.id,
        producerOrgId: approval.producerOrgId,
        entityType: approval.entityType,
        entityId: approval.entityId,
        status: approval.status,
        stage: approval.stage ?? (approval.status === "SUBMITTED" ? "submitted" : approval.entityType === "PRODUCT" && product?.status === "UNDER_REVIEW" ? "under_review" : null),
        submittedByUserId: approval.submittedByUserId,
        reviewedByUserId: approval.reviewedByUserId,
        assignedToUserId: approval.assignedToUserId,
        assignedAt: approval.assignedAt,
        slaDeadline: approval.slaDeadline,
        note: approval.note,
        createdAt: approval.createdAt,
        reviewedAt: approval.reviewedAt,
      },
      producerOrg: approval.producerOrg,
      submittedBy: submittedBy ? { id: submittedBy.id, displayName: submittedBy.profile?.displayName ?? null } : null,
      product: product ? {
        id: product.id,
        productName: product.productName,
        brandName: product.brandName,
        productType: product.productType,
        sku: product.sku,
        packSize: product.packSize,
        description: product.description,
        specJson: product.specJson,
        status: product.status,
        proofs: product.proofs?.map((p: any) => ({ id: p.id, proofType: p.proofType, media: p.media })) ?? [],
        revisionHistory: revisionHistory.map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, submittedByUserId: r.submittedByUserId, approvalId: r.approvalId, createdAt: r.createdAt })),
      } : null,
      batch: batch ? {
        id: batch.id,
        batchNo: batch.batchNo,
        status: batch.status,
        authProduct: batch.authProduct ? {
          id: batch.authProduct.id,
          productName: batch.authProduct.productName,
          proofs: batch.authProduct.proofs?.map((p: any) => ({ id: p.id, proofType: p.proofType, media: p.media })) ?? [],
        } : null,
      } : null,
    };
    return res.json(successEnvelope(payload, "Approval detail", "OK", getTraceId(req)));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const producerOrgId = toInt(req.query?.producerOrgId);
    const entityTypeParam = req.query?.entityType ? String(req.query.entityType).toUpperCase() : null;
    const entityType = entityTypeParam === "PRODUCT" || entityTypeParam === "BATCH" ? entityTypeParam : null;
    const stage = parseStage(req.query);
    const search = req.query?.search ? String(req.query.search).trim().slice(0, 200) : null;
    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit) ?? toInt(req.query?.pageSize) ?? 20));
    const page = Math.max(1, toInt(req.query?.page) ?? 1);
    const skip = (page - 1) * limit;

    const baseWhereOrg = producerOrgId != null ? { producerOrgId } : {};

    // 1) SUBMITTED approvals (staff-submitted, need admin approve/reject)
    let submittedItems: any[] = [];
    if (stage === "submitted" || stage === "all") {
      const where: any = { status: "SUBMITTED", ...baseWhereOrg };
      if (entityType) where.entityType = entityType;
      submittedItems = await prisma.producerApproval.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    }

    // 2) Platform-review: APPROVED + PRODUCT + AuthProduct.status = UNDER_REVIEW (owner submitted, need platform activate/reject)
    let underReviewRows: any[] = [];
    if (stage === "under_review" || stage === "all") {
      const approvalWhere: any = { status: "APPROVED", entityType: "PRODUCT", ...baseWhereOrg };
      const approvals = await prisma.producerApproval.findMany({
        where: approvalWhere,
        orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
      });
      if (approvals.length) {
        const productIds = approvals.map((a) => a.entityId);
        const products = await prisma.authProduct.findMany({
          where: { id: { in: productIds }, status: "UNDER_REVIEW" },
          select: { id: true, productName: true, sku: true, status: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        underReviewRows = approvals
          .filter((a) => productById.has(a.entityId))
          .map((a) => ({ ...a, stage: "under_review", entity: productById.get(a.entityId) ?? null }));
      }
    }

    // Merge and tag: submitted items get stage 'submitted'
    const submittedTagged = submittedItems.map((a) => ({ ...a, stage: "submitted" }));
    let merged = [...submittedTagged];
    for (const row of underReviewRows) {
      if (!merged.some((m) => m.id === row.id)) merged.push(row);
    }
    merged.sort((a, b) => {
      const da = a.createdAt || a.reviewedAt || 0;
      const db = b.createdAt || b.reviewedAt || 0;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    // Optional SLA breached filter
    const slaBreached = req.query?.sla === "breached";
    if (slaBreached) {
      const now = new Date();
      merged = merged.filter((row) => row.slaDeadline != null && new Date(row.slaDeadline).getTime() < now.getTime());
    }

    // Optional search filter (product name / sku)
    if (search) {
      const term = search.toLowerCase();
      merged = merged.filter((row) => {
        if (row.entityType === "PRODUCT" && row.entity) {
          const name = (row.entity.productName || "").toLowerCase();
          const sku = (row.entity.sku || "").toLowerCase();
          return name.includes(term) || sku.includes(term);
        }
        if (row.entityType === "BATCH" && row.entity?.authProduct?.productName) {
          return (row.entity.authProduct.productName || "").toLowerCase().includes(term);
        }
        return true;
      });
    }

    const total = merged.length;
    const items = merged.slice(skip, skip + limit);

    // Enrich: producerOrg, entity (product/batch) for items that don't have entity yet
    const orgIds = [...new Set(items.map((a) => a.producerOrgId))];
    const productIds = items.filter((a) => a.entityType === "PRODUCT").map((a) => a.entityId);
    const batchIds = items.filter((a) => a.entityType === "BATCH").map((a) => a.entityId);
    const [orgs, products, batches] = await Promise.all([
      orgIds.length ? prisma.producerOrg.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
      productIds.length ? prisma.authProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, productName: true, sku: true, status: true } }) : [],
      batchIds.length ? prisma.authBatch.findMany({ where: { id: { in: batchIds } }, include: { authProduct: { select: { productName: true } } } }) : [],
    ]);
    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));

    const data = items.map((a) => ({
      ...a,
      producerOrg: orgMap.get(a.producerOrgId) ?? null,
      entity: a.entity ?? (a.entityType === "PRODUCT" ? productMap.get(a.entityId) : batchMap.get(a.entityId)) ?? null,
    }));

    return res.json(
      successEnvelope(
        { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
        "Approvals fetched",
        "OK",
        traceId
      )
    );
  } catch (e: any) {
    const traceId = getTraceId(req);
    try {
      require("../../services/governance/governanceLogger").logGovernanceError(req, "admin_approvals.list failed", {
        error: e?.message,
        errorCode: e?.code,
      });
    } catch (_) {}
    return res
      .status(e?.statusCode ?? 500)
      .json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.approve = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = req.body?.note ?? null;
    const overrideCompliance = req.body?.overrideCompliance === true;
    const overrideNote = typeof req.body?.overrideNote === "string" ? req.body.overrideNote.trim() : null;

    if (approval.status === "SUBMITTED" && approval.entityType === "PRODUCT") {
      const complianceResult = await compliance.runProductComplianceChecks(prisma, approval.entityId);
      if (!complianceResult.passed) {
        if (!overrideCompliance) {
          return res.status(400).json(
            errorEnvelope(
              "COMPLIANCE_FAILED",
              "Product compliance checks failed. Override required: send { overrideCompliance: true, overrideNote?: \"...\" } to approve anyway.",
              { compliance: complianceResult },
              getTraceId(req)
            )
          );
        }
      }

      const overridePayload = overrideCompliance ? { overrideNote: overrideNote ?? undefined, overrideAt: new Date() } : undefined;
      const updated = await producerApproval.approveApproval(approval.producerOrgId, id, reviewedByUserId, note, overridePayload);

      await auditGov.createAuditEvent(prisma, {
        actorUserId: reviewedByUserId,
        actorRole: "platform.admin",
        actionKey: overrideCompliance ? "COMPLIANCE_OVERRIDE" : "admin.approval.approve",
        entityType: "PRODUCER_APPROVAL",
        entityId: String(id),
        orgId: approval.producerOrgId,
        metadata: overrideCompliance ? { overrideNote, note } : { note },
        traceId: getTraceId(req),
        ip: req.ip ?? undefined,
      });
      if (approval.entityType === "PRODUCT") {
        const product = await prisma.authProduct.findUnique({ where: { id: approval.entityId }, select: { productName: true } });
        await notifyProducerApprovalResult(prisma, {
          producerOrgId: approval.producerOrgId,
          productId: approval.entityId,
          productName: product?.productName ?? `Product #${approval.entityId}`,
          approved: true,
        }, reviewedByUserId);
      }
      return res.json(successEnvelope(updated, "Approval processed", "UPDATED", getTraceId(req)));
    }

    if (approval.status === "SUBMITTED" && approval.entityType === "BATCH") {
      const updated = await producerApproval.approveApproval(approval.producerOrgId, id, reviewedByUserId, note, undefined);
      await auditGov.createAuditEvent(prisma, {
        actorUserId: reviewedByUserId,
        actorRole: "platform.admin",
        actionKey: "admin.approval.approve",
        entityType: "PRODUCER_APPROVAL",
        entityId: String(id),
        orgId: approval.producerOrgId,
        metadata: { note },
        traceId: getTraceId(req),
        ip: req.ip ?? undefined,
      });
      return res.json(successEnvelope(updated, "Approval processed", "UPDATED", getTraceId(req)));
    }

    if (approval.status === "APPROVED" && approval.entityType === "PRODUCT") {
      const updated = await producerApproval.activateProductForPlatform(approval.producerOrgId, id, reviewedByUserId, note);
      await auditGov.createAuditEvent(prisma, {
        actorUserId: reviewedByUserId,
        actorRole: "platform.admin",
        actionKey: "admin.approval.activate",
        entityType: "PRODUCER_APPROVAL",
        entityId: String(id),
        orgId: approval.producerOrgId,
        metadata: { note },
        traceId: getTraceId(req),
        ip: req.ip ?? undefined,
      });
      const product = await prisma.authProduct.findUnique({ where: { id: approval.entityId }, select: { productName: true } });
      await notifyProducerApprovalResult(prisma, {
        producerOrgId: approval.producerOrgId,
        productId: approval.entityId,
        productName: product?.productName ?? `Product #${approval.entityId}`,
        approved: true,
      }, reviewedByUserId);
      return res.json(successEnvelope(updated, "Approval processed", "UPDATED", getTraceId(req)));
    }

    return res.status(400).json(errorEnvelope("NOT_PENDING", "Approval is not in a pending or platform-review state", undefined, getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.activate = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = req.body?.note ?? null;
    const updated = await producerApproval.activateProductForPlatform(approval.producerOrgId, id, reviewedByUserId, note);
    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.approval.activate",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(id),
      orgId: approval.producerOrgId,
      metadata: { note },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(updated, "Product activated", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.reject = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const reasonRaw =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const reason = reasonRaw.length >= 5 ? reasonRaw : "";
    if (reason.length < 5) {
      return res.status(400).json(
        errorEnvelope("REASON_REQUIRED", "Rejection reason is required (min 5 characters). Send body: { reason: \"...\" }", undefined, getTraceId(req))
      );
    }
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = reason;
    let updated: any;

    if (approval.status === "SUBMITTED") {
      updated = await producerApproval.rejectApproval(approval.producerOrgId, id, reviewedByUserId, note);
    } else if (approval.status === "APPROVED" && approval.entityType === "PRODUCT") {
      updated = await producerApproval.rejectUnderReviewProduct(approval.producerOrgId, id, reviewedByUserId, note);
    } else {
      return res
        .status(400)
        .json(
          errorEnvelope(
            "NOT_PENDING",
            "This approval has already been processed (status: " + approval.status + "). Refresh the list.",
            { currentStatus: approval.status },
            getTraceId(req)
          )
        );
    }

    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.approval.reject",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(id),
      orgId: approval.producerOrgId,
      metadata: { note, reason },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });

    if (approval.entityType === "PRODUCT") {
      const product = await prisma.authProduct.findUnique({ where: { id: approval.entityId }, select: { productName: true } });
      await notifyProducerApprovalResult(prisma, {
        producerOrgId: approval.producerOrgId,
        productId: approval.entityId,
        productName: product?.productName ?? `Product #${approval.entityId}`,
        approved: false,
        reason: note,
      }, reviewedByUserId);
    }
    return res.json(successEnvelope(updated, "Approval rejected", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.requestChanges = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id }, select: { producerOrgId: true, entityType: true, entityId: true } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));
    const reviewedByUserId = req.user?.id ?? 0;
    const updated = await producerApproval.requestChangesApproval(approval.producerOrgId, id, reviewedByUserId, notes || undefined);
    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.approval.request_changes",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(id),
      orgId: approval.producerOrgId,
      metadata: { note: notes },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    if (approval.entityType === "PRODUCT") {
      const product = await prisma.authProduct.findUnique({ where: { id: approval.entityId }, select: { productName: true } });
      await notifyProducerApprovalResult(prisma, {
        producerOrgId: approval.producerOrgId,
        productId: approval.entityId,
        productName: product?.productName ?? `Product #${approval.entityId}`,
        approved: false,
        reason: notes ? `Changes requested: ${notes}` : "Changes requested.",
      }, reviewedByUserId);
    }
    return res.json(successEnvelope(updated, "Changes requested", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.take = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const userId = req.user?.id ?? 0;
    const updated = await producerApproval.takeReviewerLock(id, userId);
    return res.json(successEnvelope(updated, "Review assigned", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.release = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const userId = req.user?.id ?? 0;
    const updated = await producerApproval.releaseReviewerLock(id, userId);
    return res.json(successEnvelope(updated, "Review released", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.archiveProduct = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const product = await prisma.authProduct.findFirst({
      where: { id: productId },
      select: { producerOrgId: true },
    });
    if (!product) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    const approvalPolicy = require("../../services/governance/approvalPolicy.service");
    await approvalPolicy.checkCanArchive(prisma, productId, product.producerOrgId);
    const updated = await prisma.authProduct.update({
      where: { id: productId },
      data: { status: "ARCHIVED" },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: req.user?.id ?? undefined,
      actorRole: "platform.admin",
      actionKey: "admin.product.archive",
      entityType: "AUTH_PRODUCT",
      entityId: String(productId),
      orgId: product.producerOrgId,
      metadata: {},
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(updated, "Product archived", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.hideProduct = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 5) return res.status(400).json(errorEnvelope("REASON_REQUIRED", "Reason required (min 5 characters)", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const product = await prisma.authProduct.findFirst({
      where: { id: productId },
      select: { id: true, producerOrgId: true, status: true },
    });
    if (!product) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    if (product.status !== "ACTIVE") return res.status(400).json(errorEnvelope("INVALID_STATE", "Only ACTIVE products can be hidden", undefined, getTraceId(req)));
    const userId = req.user?.id ?? 0;
    let incidentId: number | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.authProduct.update({
        where: { id: productId },
        data: { status: "INACTIVE" },
      });
      const incident = await tx.governanceIncident.create({
        data: {
          entityType: "PRODUCT",
          entityId: productId,
          producerOrgId: product.producerOrgId,
          incidentType: (req.body?.incidentType as string) || "POLICY_VIOLATION",
          severity: (req.body?.severity as string) || "MEDIUM",
          actionTaken: "HIDDEN",
          reason,
          ticketId: req.body?.ticketId ? String(req.body.ticketId) : null,
          createdByUserId: userId,
        },
      });
      incidentId = incident.id;
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.product.hide",
      entityType: "AUTH_PRODUCT",
      entityId: String(productId),
      orgId: product.producerOrgId,
      metadata: { reason, incidentId },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    const updated = await prisma.authProduct.findUnique({ where: { id: productId } });
    return res.json(successEnvelope({ ...updated, incidentId }, "Product hidden", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

/** Unhide product: restore INACTIVE -> ACTIVE and create incident (actionTaken RESTORED). */
exports.unhideProduct = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const product = await prisma.authProduct.findFirst({
      where: { id: productId },
      select: { id: true, producerOrgId: true, status: true },
    });
    if (!product) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    if ((product.status as string) !== "INACTIVE") {
      return res.status(400).json(errorEnvelope("INVALID_STATE", "Only hidden (INACTIVE) products can be unhidden", undefined, getTraceId(req)));
    }
    const userId = req.user?.id ?? 0;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "Product restored by admin";
    let incidentId: number | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.authProduct.update({
        where: { id: productId },
        data: { status: "ACTIVE" },
      });
      const incident = await tx.governanceIncident.create({
        data: {
          entityType: "PRODUCT",
          entityId: productId,
          producerOrgId: product.producerOrgId,
          incidentType: "RESTORATION",
          severity: "LOW",
          actionTaken: "RESTORED",
          reason,
          createdByUserId: userId,
        },
      });
      incidentId = incident.id;
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.product.unhide",
      entityType: "AUTH_PRODUCT",
      entityId: String(productId),
      orgId: product.producerOrgId,
      metadata: { incidentId },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    const updated = await prisma.authProduct.findUnique({ where: { id: productId } });
    return res.json(successEnvelope({ ...updated, incidentId }, "Product unhidden", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.unarchiveProduct = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const product = await prisma.authProduct.findFirst({
      where: { id: productId },
      select: { producerOrgId: true },
    });
    if (!product) return res.status(404).json(errorEnvelope("NOT_FOUND", "Product not found", undefined, getTraceId(req)));
    const approvalPolicy = require("../../services/governance/approvalPolicy.service");
    await approvalPolicy.checkCanUnarchive(prisma, productId, product.producerOrgId);
    const updated = await prisma.authProduct.update({
      where: { id: productId },
      data: { status: "INACTIVE" },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: req.user?.id ?? undefined,
      actorRole: "platform.admin",
      actionKey: "admin.product.unarchive",
      entityType: "AUTH_PRODUCT",
      entityId: String(productId),
      orgId: product.producerOrgId,
      metadata: {},
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(updated, "Product unarchived", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.getProductRevisions = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    if (productId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid product id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const productRevision = require("../../services/governance/productRevision.service");
    const history = await productRevision.getRevisionHistory(prisma, productId);
    return res.json(successEnvelope(history, "Revision history", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.getRevisionDiff = async (req: any, res: any) => {
  try {
    const productId = toInt(req.params?.productId);
    const revA = toInt(req.query?.revA);
    const revB = toInt(req.query?.revB);
    if (productId == null || revA == null || revB == null) {
      return res.status(400).json(errorEnvelope("INVALID_PARAMS", "productId, revA and revB required", undefined, getTraceId(req)));
    }
    const prisma = getPrisma(req);
    const productRevision = require("../../services/governance/productRevision.service");
    const diff = await productRevision.getRevisionDiff(prisma, productId, revA, revB);
    return res.json(successEnvelope(diff, "Revision diff", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

export {};
