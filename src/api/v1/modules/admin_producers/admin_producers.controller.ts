/**
 * Admin Producer Governance controller. Uses service layer only; DTO envelope with traceId.
 */

const adminProducersService = require("./admin_producers.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");
const featureFlag = require("../../services/governance/featureFlag.service");
const quota = require("../../services/governance/quota.service");
const auditGov = require("../../services/governance/auditGovernance.service");
const { logGovernanceError } = require("../../services/governance/governanceLogger");

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
    const params = {
      status: req.query?.status ? String(req.query.status) : undefined,
      kycStatus: req.query?.kycStatus ? String(req.query.kycStatus) : undefined,
      search: req.query?.search ? String(req.query.search) : undefined,
      page: toInt(req.query?.page) ?? 1,
      pageSize: toInt(req.query?.pageSize) ?? toInt(req.query?.limit) ?? 20,
    };
    const data = await adminProducersService.listProducers(prisma, params);
    return res.json(successEnvelope(data, "Producer organizations fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    logGovernanceError(req, "admin_producers.list failed", { error: e?.message, errorCode: e?.code });
    const status = e?.statusCode ?? 500;
    return res.status(status).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getOne = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const data = await adminProducersService.getProducerDetail(prisma, orgId);
    if (!data) return res.status(404).json(errorEnvelope("NOT_FOUND", "Producer organization not found", { orgId }, traceId));
    return res.json(successEnvelope(data, "Producer organization detail fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.suspend = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? null;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const result = await adminProducersService.suspendProducer(
      prisma,
      orgId,
      userId ?? 0,
      "platform.admin",
      body.reason ?? null,
      traceId,
      req.ip ?? null
    );
    if (!result) return res.status(404).json(errorEnvelope("NOT_FOUND", "Producer organization not found", { orgId }, traceId));
    return res.json(successEnvelope({ ...result.updated, incidentId: result.incidentId }, "Producer organization suspended", "UPDATED", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.unsuspend = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? null;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const result = await adminProducersService.unsuspendProducer(
      prisma,
      orgId,
      userId ?? 0,
      "platform.admin",
      body.reason ?? null,
      traceId,
      req.ip ?? null
    );
    if (!result) return res.status(404).json(errorEnvelope("NOT_FOUND", "Producer organization not found", { orgId }, traceId));
    return res.json(successEnvelope({ ...result.updated, incidentId: result.incidentId }, "Producer organization unsuspended", "UPDATED", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getFlags = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const data = await featureFlag.getFlags(prisma, orgId);
    return res.json(successEnvelope(data, "Feature flags fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.putFlags = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? null;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const flags = Array.isArray(body.flags) ? body.flags : [];
    const updates = flags.map((f: any) => ({ key: String(f.key), enabled: Boolean(f.enabled) }));
    const updatedFlags = await featureFlag.setFlags(prisma, orgId, updates, userId);
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId ?? undefined,
      actorRole: "platform.admin",
      actionKey: "admin.producer.flags.update",
      entityType: "PRODUCER_ORG",
      entityId: String(orgId),
      orgId,
      metadata: { changed: updates, reason: body.reason ?? null },
      traceId,
      ip: req.ip ?? undefined,
    });
    return res.json(
      successEnvelope(
        { orgId, updatedFlags },
        "Feature flags updated",
        "UPDATED",
        traceId
      )
    );
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getQuotas = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const data = await quota.getQuotas(prisma, orgId);
    return res.json(successEnvelope(data, "Quotas fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.putQuotas = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? null;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const quotas = Array.isArray(body.quotas) ? body.quotas : [];
    const updates = quotas.map((q: any) => ({
      key: String(q.key),
      limit: Number(q.limit) || 0,
      resetPeriod: q.resetPeriod === "MONTHLY" ? "MONTHLY" : "DAILY",
    }));
    const data = await quota.setQuotas(prisma, orgId, updates, userId);
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId ?? undefined,
      actorRole: "platform.admin",
      actionKey: "admin.producer.quotas.update",
      entityType: "PRODUCER_ORG",
      entityId: String(orgId),
      orgId,
      metadata: { reason: body.reason ?? null },
      traceId,
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(data, "Quotas updated", "UPDATED", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getAudit = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const params = {
      limit: toInt(req.query?.limit) ?? 50,
      offset: toInt(req.query?.offset) ?? 0,
      entityType: req.query?.entityType ? String(req.query.entityType) : undefined,
      actionKey: req.query?.actionKey ? String(req.query.actionKey) : undefined,
      fromDate: req.query?.fromDate ? String(req.query.fromDate) : undefined,
      toDate: req.query?.toDate ? String(req.query.toDate) : undefined,
    };
    const data = await adminProducersService.getAuditEvents(prisma, orgId, params);
    return res.json(successEnvelope(data, "Audit timeline fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getMetrics = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const data = await adminProducersService.getProducerMetrics(prisma, orgId);
    if (!data) return res.status(404).json(errorEnvelope("NOT_FOUND", "Producer organization not found", { orgId }, traceId));
    return res.json(successEnvelope(data, "Producer metrics fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getPrintJobs = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const params = {
      limit: toInt(req.query?.limit) ?? 50,
      offset: toInt(req.query?.offset) ?? 0,
      fromDate: req.query?.fromDate ? String(req.query.fromDate) : undefined,
      toDate: req.query?.toDate ? String(req.query.toDate) : undefined,
    };
    const data = await adminProducersService.getPrintJobs(prisma, orgId, params);
    if (!data) return res.status(404).json(errorEnvelope("NOT_FOUND", "Producer organization not found", { orgId }, traceId));
    return res.json(successEnvelope(data, "Print jobs fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

exports.getStaff = async (req: any, res: any) => {
  try {
    const orgId = toInt(req.params?.orgId);
    if (orgId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid orgId", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const staff = await prisma.producerOrgStaff.findMany({
      where: { producerOrgId: orgId },
      include: {
        user: { include: { profile: true, auth: { select: { email: true, phone: true } } } },
        role: { select: { key: true, label: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(successEnvelope(staff, "Staff list fetched", "OK", traceId));
  } catch (e: any) {
    const traceId = getTraceId(req);
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, traceId));
  }
};

export {};
