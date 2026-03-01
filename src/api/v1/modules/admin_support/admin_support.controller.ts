/**
 * Admin support tickets controller. Uses admin_support.service; envelope + traceId.
 */

const service = require("./admin_support.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const params = {
      status: req.query?.status ? String(req.query.status) : undefined,
      priority: req.query?.priority ? String(req.query.priority) : undefined,
      category: req.query?.category ? String(req.query.category) : undefined,
      producerOrgId: req.query?.producerOrgId != null ? toInt(req.query.producerOrgId) : undefined,
      assignedToUserId: req.query?.assignedToUserId !== undefined ? (req.query.assignedToUserId === "" ? null : toInt(req.query.assignedToUserId)) : undefined,
      search: req.query?.search ? String(req.query.search) : undefined,
      dateFrom: req.query?.dateFrom ? String(req.query.dateFrom) : undefined,
      dateTo: req.query?.dateTo ? String(req.query.dateTo) : undefined,
      page: toInt(req.query?.page) ?? 1,
      pageSize: toInt(req.query?.pageSize) ?? toInt(req.query?.limit) ?? 20,
    };
    const data = await service.listTickets(prisma, params);
    return res.json(successEnvelope(data, "Tickets list", "OK", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "List failed", undefined, getTraceId(req)));
  }
};

exports.stats = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const data = await service.getTicketStats(prisma);
    return res.json(successEnvelope(data, "Ticket stats", "OK", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Stats failed", undefined, getTraceId(req)));
  }
};

exports.getOne = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const traceId = getTraceId(req);
    const ticket = await service.getTicketDetail(prisma, id);
    if (!ticket) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, traceId));
    return res.json(successEnvelope(ticket, "Ticket detail", "OK", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Fetch failed", undefined, getTraceId(req)));
  }
};

exports.update = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? 0;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const input: any = {};
    if (body.status !== undefined) input.status = body.status;
    if (body.priority !== undefined) input.priority = body.priority;
    if (body.category !== undefined) input.category = body.category;
    if (body.assignedToUserId !== undefined) input.assignedToUserId = body.assignedToUserId === null || body.assignedToUserId === "" ? null : toInt(body.assignedToUserId);
    const updated = await service.updateTicket(prisma, id, input, userId);
    if (!updated) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, traceId));
    return res.json(successEnvelope(updated, "Ticket updated", "OK", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Update failed", undefined, getTraceId(req)));
  }
};

exports.reply = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? 0;
    const traceId = getTraceId(req);
    const message = (req.body?.message ?? "").trim();
    if (!message) return res.status(400).json(errorEnvelope("VALIDATION", "Message is required", undefined, traceId));
    const msg = await service.addAdminReply(prisma, id, { message, isInternal: false }, userId);
    if (!msg) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, traceId));
    return res.status(201).json(successEnvelope(msg, "Reply added", "CREATED", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Reply failed", undefined, getTraceId(req)));
  }
};

exports.addInternalNote = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? 0;
    const traceId = getTraceId(req);
    const message = (req.body?.message ?? "").trim();
    if (!message) return res.status(400).json(errorEnvelope("VALIDATION", "Message is required", undefined, traceId));
    const msg = await service.addAdminReply(prisma, id, { message, isInternal: true }, userId);
    if (!msg) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, traceId));
    return res.status(201).json(successEnvelope(msg, "Internal note added", "CREATED", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Add note failed", undefined, getTraceId(req)));
  }
};

exports.escalate = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const userId = req.user?.id ?? 0;
    const traceId = getTraceId(req);
    const body = req.body ?? {};
    const ticket = await service.escalateToEnforcement(prisma, id, { summary: body.summary, details: body.details }, userId);
    if (!ticket) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, traceId));
    return res.json(successEnvelope(ticket, "Ticket escalated to enforcement case", "OK", traceId));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Escalate failed", undefined, getTraceId(req)));
  }
};
