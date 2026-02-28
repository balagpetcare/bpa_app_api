/**
 * Admin approval queue: list pending ProducerApprovals, approve/reject by platform admin.
 */

const producerApproval = require("../producer/producerApproval.service");
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

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const producerOrgId = toInt(req.query?.producerOrgId);
    const status = "SUBMITTED";
    const where: { status: string; producerOrgId?: number } = { status };
    if (producerOrgId != null) where.producerOrgId = producerOrgId;

    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit) ?? 50));
    const page = Math.max(1, toInt(req.query?.page) ?? 1);
    const items = await prisma.producerApproval.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: (page - 1) * limit,
    });

    const orgIds = [...new Set(items.map((a) => a.producerOrgId))];
    const productIds = items.filter((a) => a.entityType === "PRODUCT").map((a) => a.entityId);
    const batchIds = items.filter((a) => a.entityType === "BATCH").map((a) => a.entityId);
    const [orgs, products, batches] = await Promise.all([
      orgIds.length ? prisma.producerOrg.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
      productIds.length ? prisma.authProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, productName: true, sku: true } }) : [],
      batchIds.length ? prisma.authBatch.findMany({ where: { id: { in: batchIds } }, include: { authProduct: { select: { productName: true } } } }) : [],
    ]);
    const orgMap = new Map(orgs.map((o) => [o.id, o]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));

    const data = items.map((a) => ({
      ...a,
      producerOrg: orgMap.get(a.producerOrgId) ?? null,
      entity: a.entityType === "PRODUCT" ? productMap.get(a.entityId) : batchMap.get(a.entityId) ?? null,
    }));
    return res.json(successEnvelope(data, "Pending approvals fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    try { require("../../services/governance/governanceLogger").logGovernanceError(req, "admin_approvals.list failed", { error: e?.message, errorCode: e?.code }); } catch (_) {}
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.approve = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));
    if (approval.status !== "SUBMITTED") return res.status(400).json(errorEnvelope("NOT_PENDING", "Approval is not pending", undefined, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = req.body?.note ?? null;
    const updated = await producerApproval.approveApproval(approval.producerOrgId, id, reviewedByUserId, note);

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
    return res.json(successEnvelope(updated, "Approval approved", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.reject = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid approval id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const approval = await prisma.producerApproval.findFirst({ where: { id } });
    if (!approval) return res.status(404).json(errorEnvelope("NOT_FOUND", "Approval not found", { id }, getTraceId(req)));
    if (approval.status !== "SUBMITTED") return res.status(400).json(errorEnvelope("NOT_PENDING", "Approval is not pending", undefined, getTraceId(req)));

    const reviewedByUserId = req.user?.id ?? 0;
    const note = req.body?.note ?? req.body?.reason ?? null;
    const updated = await producerApproval.rejectApproval(approval.producerOrgId, id, reviewedByUserId, note);

    await auditGov.createAuditEvent(prisma, {
      actorUserId: reviewedByUserId,
      actorRole: "platform.admin",
      actionKey: "admin.approval.reject",
      entityType: "PRODUCER_APPROVAL",
      entityId: String(id),
      orgId: approval.producerOrgId,
      metadata: { note },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(updated, "Approval rejected", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};
