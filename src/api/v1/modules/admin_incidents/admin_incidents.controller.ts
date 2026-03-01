/**
 * Phase 4: Governance incidents CRUD — create, list, get, resolve.
 */

const auditGov = require("../../services/governance/auditGovernance.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");
const { buildIncidentsWhereClause } = require("./incidentsListFilter");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

exports.stats = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const [total, unresolved, resolved] = await Promise.all([
      prisma.governanceIncident.count(),
      prisma.governanceIncident.count({ where: { resolvedAt: null } }),
      prisma.governanceIncident.count({ where: { resolvedAt: { not: null } } }),
    ]);
    return res.json(
      successEnvelope(
        { total, unresolved, resolved },
        "Incident stats",
        "OK",
        getTraceId(req)
      )
    );
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const limit = Math.min(200, Math.max(1, toInt(req.query?.limit) ?? 20));
    const page = Math.max(1, toInt(req.query?.page) ?? 1);
    const skip = (page - 1) * limit;
    const where = buildIncidentsWhereClause(req.query || {});

    const [data, total] = await Promise.all([
      prisma.governanceIncident.findMany({
        where,
        include: { producerOrg: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.governanceIncident.count({ where }),
    ]);

    return res.json(
      successEnvelope(
        { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
        "Incidents fetched",
        "OK",
        getTraceId(req)
      )
    );
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.create = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const entityType = body.entityType ? String(body.entityType) : "";
    const entityId = toInt(body.entityId);
    const producerOrgId = toInt(body.producerOrgId);
    const incidentType = body.incidentType ? String(body.incidentType) : "POLICY_VIOLATION";
    const severity = body.severity ? String(body.severity) : "MEDIUM";
    const actionTaken = body.actionTaken ? String(body.actionTaken) : "WARNING";
    const reason = body.reason ? String(body.reason).trim() : "";
    if (!entityType || entityId == null || producerOrgId == null) {
      return res.status(400).json(errorEnvelope("INVALID_BODY", "entityType, entityId, producerOrgId required", undefined, getTraceId(req)));
    }
    if (reason.length < 5) {
      return res.status(400).json(errorEnvelope("REASON_REQUIRED", "reason required (min 5 characters)", undefined, getTraceId(req)));
    }
    const userId = req.user?.id ?? 0;
    const ticketId = body.ticketId ? String(body.ticketId) : null;
    const incident = await prisma.governanceIncident.create({
      data: {
        entityType,
        entityId,
        producerOrgId,
        incidentType,
        severity,
        actionTaken,
        reason,
        ticketId,
        createdByUserId: userId,
      },
      include: { producerOrg: { select: { id: true, name: true } } },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.incident.create",
      entityType: "GOVERNANCE_INCIDENT",
      entityId: String(incident.id),
      orgId: producerOrgId,
      metadata: { incidentType, severity, actionTaken },
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(incident, "Incident created", "CREATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.getOne = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid incident id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const incident = await prisma.governanceIncident.findUnique({
      where: { id },
      include: { producerOrg: { select: { id: true, name: true } } },
    });
    if (!incident) return res.status(404).json(errorEnvelope("NOT_FOUND", "Incident not found", { id }, getTraceId(req)));
    return res.json(successEnvelope(incident, "Incident detail", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.resolve = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid incident id", undefined, getTraceId(req)));
    const resolutionNote = req.body?.resolutionNote ? String(req.body.resolutionNote).trim() : null;
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? 0;
    const now = new Date();
    const incident = await prisma.governanceIncident.update({
      where: { id },
      data: { resolvedAt: now, resolvedByUserId: userId, resolutionNote: resolutionNote ?? undefined },
      include: { producerOrg: { select: { id: true, name: true } } },
    });
    await auditGov.createAuditEvent(prisma, {
      actorUserId: userId,
      actorRole: "platform.admin",
      actionKey: "admin.incident.resolve",
      entityType: "GOVERNANCE_INCIDENT",
      entityId: String(id),
      orgId: incident.producerOrgId,
      metadata: {},
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(incident, "Incident resolved", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

export {};
