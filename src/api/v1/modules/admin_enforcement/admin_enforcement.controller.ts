/**
 * Trust & Safety / Enforcement: cases list, create, detail, update, evidence, actions, trace, revert.
 */

const enforcementService = require("./admin_enforcement.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");

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
    const data = await enforcementService.getCaseStats(prisma);
    return res.json(successEnvelope(data, "Enforcement case stats", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const query = req.query || {};
    const data = await enforcementService.listCases(prisma, {
      entityType: query.entityType ? String(query.entityType) : undefined,
      producerOrgId: toInt(query.producerOrgId) ?? toInt(query.orgId),
      status: query.status ? String(query.status) : undefined,
      severity: query.severity ? String(query.severity) : undefined,
      q: query.q ? String(query.q).trim() : undefined,
      dateFrom: parseDate(query.dateFrom),
      dateTo: parseDate(query.dateTo),
      page: toInt(query.page) ?? 1,
      limit: toInt(query.limit) ?? toInt(query.pageSize) ?? 20,
    });
    return res.json(successEnvelope(data, "Cases fetched", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.create = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const entityType = body.entityType ? String(body.entityType) : "ORG";
    const producerOrgId = toInt(body.producerOrgId);
    const entityId = body.entityId != null ? String(body.entityId) : (producerOrgId != null ? String(producerOrgId) : "");
    if (!entityId && (producerOrgId == null || producerOrgId <= 0)) {
      return res.status(400).json(errorEnvelope("INVALID_BODY", "entityId or producerOrgId required", undefined, getTraceId(req)));
    }
    const caseRecord = await enforcementService.createCase(prisma, {
      source: body.source ? String(body.source) : undefined,
      entityType,
      entityId: entityId || (producerOrgId != null ? String(producerOrgId) : ""),
      producerOrgId: producerOrgId != null && producerOrgId > 0 ? producerOrgId : undefined,
      severity: body.severity ? String(body.severity) : undefined,
      summary: body.summary ? String(body.summary).trim() : "",
      details: body.details ? String(body.details) : null,
      createdByUserId: req.user?.id ?? 0,
    });
    return res.status(201).json(successEnvelope(caseRecord, "Case created", "CREATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.getOne = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid case id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const caseRecord = await enforcementService.getCaseById(prisma, id);
    if (!caseRecord) return res.status(404).json(errorEnvelope("NOT_FOUND", "Case not found", { id }, getTraceId(req)));
    const trace = await enforcementService.getCaseTrace(prisma, {
      entityType: caseRecord.entityType,
      entityId: caseRecord.entityId,
      producerOrgId: caseRecord.producerOrgId,
    });
    return res.json(successEnvelope({ ...caseRecord, trace }, "Case detail", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.update = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid case id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const caseRecord = await enforcementService.updateCase(prisma, id, {
      status: body.status ? String(body.status) : undefined,
      assignedToUserId: body.assignedToUserId !== undefined ? toInt(body.assignedToUserId) : undefined,
      severity: body.severity ? String(body.severity) : undefined,
      resolutionNote: body.resolutionNote !== undefined ? String(body.resolutionNote) : undefined,
      resolvedByUserId: body.status === "RESOLVED" || body.status === "REJECTED" ? (req.user?.id ?? null) : undefined,
    });
    const updated = await enforcementService.getCaseById(prisma, id);
    return res.json(successEnvelope(updated ?? caseRecord, "Case updated", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.addEvidence = async (req: any, res: any) => {
  try {
    const caseId = toInt(req.params?.id);
    if (caseId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid case id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const evidence = await enforcementService.addEvidence(prisma, caseId, {
      type: body.type ? String(body.type) : "TEXT",
      url: body.url != null ? String(body.url) : null,
      note: body.note != null ? String(body.note) : null,
      createdByUserId: req.user?.id ?? 0,
    });
    return res.status(201).json(successEnvelope(evidence, "Evidence added", "CREATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.applyAction = async (req: any, res: any) => {
  try {
    const caseId = toInt(req.params?.id);
    if (caseId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid case id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const actionType = body.actionType ? String(body.actionType) : "";
    const targetType = body.targetType ? String(body.targetType) : "";
    const targetId = body.targetId != null ? String(body.targetId) : "";
    const reason = body.reason ? String(body.reason).trim() : "";
    if (!actionType || !targetType || !targetId) {
      return res.status(400).json(errorEnvelope("INVALID_BODY", "actionType, targetType, targetId required", undefined, getTraceId(req)));
    }
    const action = await enforcementService.applyAction(prisma, {
      caseId,
      targetType,
      targetId,
      actionType,
      reason,
      meta: body.meta ?? undefined,
      appliedByUserId: req.user?.id ?? 0,
      actorRole: req.user?.role ?? "platform.admin",
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.status(201).json(successEnvelope(action, "Action applied", "CREATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.revertAction = async (req: any, res: any) => {
  try {
    const actionId = toInt(req.params?.id);
    if (actionId == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid action id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const body = req.body ?? {};
    const revertNote = body.revertNote ? String(body.revertNote).trim() : "";
    const action = await enforcementService.revertAction(prisma, actionId, {
      revertedByUserId: req.user?.id ?? 0,
      revertNote,
      actorRole: req.user?.role ?? "platform.admin",
      traceId: getTraceId(req),
      ip: req.ip ?? undefined,
    });
    return res.json(successEnvelope(action, "Action reverted", "UPDATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};

exports.trace = async (req: any, res: any) => {
  try {
    const code = req.query?.code ? String(req.query.code).trim() : "";
    if (!code) return res.status(400).json(errorEnvelope("MISSING_CODE", "query code required", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const data = await enforcementService.traceByCode(prisma, code);
    if (!data) return res.json(successEnvelope({ found: false, message: "Code not found" }, "Trace", "OK", getTraceId(req)));
    return res.json(successEnvelope({ found: true, ...data }, "Trace", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Server error", undefined, getTraceId(req)));
  }
};
