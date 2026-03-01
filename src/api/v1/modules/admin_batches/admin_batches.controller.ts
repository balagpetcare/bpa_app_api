/**
 * Admin Batch & Code Control: list batches, detail, approve, reject, void, archive.
 */

const producerApproval = require("../producer/producerApproval.service");
const approvalPolicy = require("../../services/governance/approvalPolicy.service");
const auditGov = require("../../services/governance/auditGovernance.service");
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

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const producerOrgId = toInt(req.query?.producerOrgId);
    const productId = toInt(req.query?.productId);
    const status = req.query?.status ? String(req.query.status).toUpperCase() : null;
    const frozen = req.query?.frozen === "true" ? true : req.query?.frozen === "false" ? false : null;
    const dateFrom = parseDate(req.query?.dateFrom);
    const dateTo = parseDate(req.query?.dateTo);
    const search = typeof req.query?.search === "string" ? req.query.search.trim().slice(0, 200) : null;
    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit) ?? toInt(req.query?.pageSize) ?? 20));
    const page = Math.max(1, toInt(req.query?.page) ?? 1);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (producerOrgId != null) where.authProduct = { producerOrgId };
    if (productId != null) where.authProductId = productId;
    if (status) where.status = status;
    if (frozen === true) where.frozenAt = { not: null };
    if (frozen === false) where.frozenAt = null;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }
    if (search) {
      const orList: any[] = [
        { batchNo: { contains: search, mode: "insensitive" } },
        { authProduct: { productName: { contains: search, mode: "insensitive" } } },
        { authProduct: { sku: { contains: search, mode: "insensitive" } } },
      ];
      const idNum = toInt(search);
      if (idNum != null) orList.push({ id: idNum });
      where.OR = orList;
    }

    const [data, total] = await Promise.all([
      prisma.authBatch.findMany({
        where,
        include: {
          authProduct: { select: { id: true, productName: true, sku: true, producerOrgId: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      prisma.authBatch.count({ where }),
    ]);

    const orgIds = [...new Set(data.map((b: any) => b.authProduct?.producerOrgId).filter(Boolean))];
    const orgs = orgIds.length
      ? await prisma.producerOrg.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const orgMap = new Map(orgs.map((o: any) => [o.id, o]));

    const batchIds = data.map((b: any) => b.id);
    const approvals =
      batchIds.length > 0
        ? await prisma.producerApproval.findMany({
            where: { entityType: "BATCH", entityId: { in: batchIds } },
            select: { entityId: true, slaDeadline: true, assignedToUserId: true, status: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
    const approvalByBatch = new Map<number, any>();
    for (const a of approvals) {
      if (!approvalByBatch.has(a.entityId)) approvalByBatch.set(a.entityId, a);
    }

    const items = data.map((b: any) => ({
      ...b,
      producerOrg: b.authProduct ? orgMap.get(b.authProduct.producerOrgId) ?? null : null,
      approval: approvalByBatch.get(b.id) ?? null,
    }));

    return res.json(
      successEnvelope(
        { data: items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
        "Batches fetched",
        "OK",
        traceId
      )
    );
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.getDetail = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);

    const batch = await prisma.authBatch.findUnique({
      where: { id },
      include: {
        authProduct: {
          include: {
            producerOrg: { select: { id: true, name: true } },
            proofs: { include: { media: { select: { id: true, url: true } } } },
          },
        },
        serialState: true,
        allocationLogs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", { id }, getTraceId(req)));

    const codeCounts = await prisma.authCode.groupBy({
      by: ["status"],
      where: { batchId: id },
      _count: true,
    });
    const codeCountsMap = codeCounts.reduce((acc: any, r: any) => ({ ...acc, [r.status]: r._count }), {});
    const approval = await prisma.producerApproval.findFirst({
      where: { entityType: "BATCH", entityId: id },
      select: {
        id: true,
        status: true,
        submittedByUserId: true,
        reviewedByUserId: true,
        assignedToUserId: true,
        slaDeadline: true,
        note: true,
        createdAt: true,
        reviewedAt: true,
      },
    });

    const serialState = (batch as any).serialState;
    const serialStats = {
      totalGenerated: batch.qtyGenerated ?? 0,
      allocated: serialState?.allocatedCount ?? 0,
      verified: codeCountsMap.VERIFIED ?? 0,
      blocked: codeCountsMap.BLOCKED ?? 0,
      unused: codeCountsMap.UNUSED ?? 0,
      sold: codeCountsMap.SOLD ?? 0,
      expired: codeCountsMap.EXPIRED ?? 0,
    };
    const printHistory = batch.printedAt
      ? {
          printedAt: batch.printedAt,
          printedByUserId: batch.printedByUserId,
          printCount: batch.printCount ?? 0,
        }
      : null;

    return res.json(
      successEnvelope(
        {
          batch,
          codeCounts: codeCountsMap,
          serialStats,
          printHistory,
          approval,
        },
        "Batch detail",
        "OK",
        getTraceId(req)
      )
    );
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.approve = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      include: { authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId;
    if (!producerOrgId) return res.status(400).json(errorEnvelope("INVALID_STATE", "Batch has no producer org", undefined, getTraceId(req)));

    await approvalPolicy.checkProductApprovedForBatch(prisma, batchId);
    const approval = await prisma.producerApproval.findFirst({
      where: { producerOrgId, entityType: "BATCH", entityId: batchId },
    });
    if (!approval) return res.status(404).json(errorEnvelope("APPROVAL_NOT_FOUND", "No approval record for this batch", undefined, getTraceId(req)));
    if (approval.status !== "SUBMITTED") return res.status(400).json(errorEnvelope("NOT_PENDING", "Approval is not pending", undefined, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = req.body?.note ?? null;
    const updated = await producerApproval.approveApproval(producerOrgId, approval.id, reviewedByUserId, note);

    await prisma.authBatch.update({
      where: { id: batchId },
      data: { reviewedAt: new Date(), reviewedByAdminId: reviewedByUserId, reviewNotes: note ? String(note) : null },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.batch.approve",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: { note },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });

    return res.json(successEnvelope(updated, "Batch approved", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.reject = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (reason.length < 5) return res.status(400).json(errorEnvelope("REASON_REQUIRED", "Rejection reason required (min 5 characters)", undefined, getTraceId(req)));

    const prisma = getPrisma(req);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      include: { authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId;
    if (!producerOrgId) return res.status(400).json(errorEnvelope("INVALID_STATE", "Batch has no producer org", undefined, getTraceId(req)));

    const approval = await prisma.producerApproval.findFirst({
      where: { producerOrgId, entityType: "BATCH", entityId: batchId },
    });
    if (!approval) return res.status(404).json(errorEnvelope("APPROVAL_NOT_FOUND", "No approval record for this batch", undefined, getTraceId(req)));
    if (approval.status !== "SUBMITTED") return res.status(400).json(errorEnvelope("NOT_PENDING", "Approval is not pending", undefined, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const updated = await producerApproval.rejectApproval(producerOrgId, approval.id, reviewedByUserId, reason);
    await prisma.authBatch.update({
      where: { id: batchId },
      data: { reviewedAt: new Date(), reviewedByAdminId: reviewedByUserId, reviewNotes: reason },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.batch.reject",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: { reason },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(updated, "Batch rejected", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.voidBatch = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 5) return res.status(400).json(errorEnvelope("REASON_REQUIRED", "Void reason required (min 5 characters)", undefined, getTraceId(req)));

    const prisma = getPrisma(req);
    await approvalPolicy.checkCanVoidBatch(prisma, batchId);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      include: { authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId ?? 0;
    const userId = req.user?.id ?? 0;
    const now = new Date();
    await prisma.authBatch.update({
      where: { id: batchId },
      data: { status: "VOIDED", voidedAt: now, voidedByUserId: userId, voidReason: reason },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.batch.void",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: { reason },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope({ id: batchId, status: "VOIDED" }, "Batch voided", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.freeze = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 5) return res.status(400).json(errorEnvelope("REASON_REQUIRED", "Reason required (min 5 characters)", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      include: { authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId ?? 0;
    const userId = req.user?.id ?? 0;
    let incidentId: number | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.authBatch.update({
        where: { id: batchId },
        data: { frozenAt: new Date() },
      });
      const incident = await tx.governanceIncident.create({
        data: {
          entityType: "BATCH",
          entityId: batchId,
          producerOrgId,
          incidentType: (req.body?.incidentType as string) || "POLICY_VIOLATION",
          severity: (req.body?.severity as string) || "MEDIUM",
          actionTaken: "FROZEN",
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
      actionKey: "admin.batch.freeze",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: { reason, incidentId },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    const updated = await prisma.authBatch.findUnique({ where: { id: batchId } });
    return res.json(successEnvelope({ ...updated, incidentId }, "Batch frozen", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.unfreeze = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      select: { frozenAt: true, authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    if (!batch.frozenAt) return res.status(400).json(errorEnvelope("INVALID_STATE", "Batch is not frozen", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId ?? 0;
    const userId = req.user?.id ?? 0;
    let incidentId: number | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.authBatch.update({
        where: { id: batchId },
        data: { frozenAt: null },
      });
      const incident = await tx.governanceIncident.create({
        data: {
          entityType: "BATCH",
          entityId: batchId,
          producerOrgId,
          incidentType: "RESTORATION",
          severity: "LOW",
          actionTaken: "UNFROZEN",
          reason: "Batch unfrozen by admin",
          createdByUserId: userId,
        },
      });
      incidentId = incident.id;
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.batch.unfreeze",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: { incidentId },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    const updated = await prisma.authBatch.findUnique({ where: { id: batchId } });
    return res.json(successEnvelope({ ...updated, incidentId }, "Batch unfrozen", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.archive = async (req: any, res: any) => {
  try {
    const batchId = toInt(req.params?.id);
    if (batchId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid batch id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const batch = await prisma.authBatch.findUnique({
      where: { id: batchId },
      include: { authProduct: { select: { producerOrgId: true } } },
    });
    if (!batch) return res.status(404).json(errorEnvelope("NOT_FOUND", "Batch not found", undefined, getTraceId(req)));
    const producerOrgId = batch.authProduct?.producerOrgId ?? 0;
    const allowed = ["REJECTED", "VOIDED", "PRINTED"];
    if (!allowed.includes(batch.status)) {
      return res.status(400).json(errorEnvelope("INVALID_STATE", `Archive only for ${allowed.join(", ")} batches`, undefined, getTraceId(req)));
    }
    await prisma.authBatch.update({
      where: { id: batchId },
      data: { status: "ARCHIVED" },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: req.user?.id ?? undefined,
      actorRole: "platform.admin",
      actionKey: "admin.batch.archive",
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
      orgId: producerOrgId,
      metadata: {},
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope({ id: batchId, status: "ARCHIVED" }, "Batch archived", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

export {};
