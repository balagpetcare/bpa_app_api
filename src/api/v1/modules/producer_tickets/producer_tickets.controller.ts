/**
 * Producer support tickets controller. Org-scoped; uses producer_tickets.service.
 */

const service = require("./producer_tickets.service");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");

function getPrisma(req: any) {
  if (!req.prisma) throw new Error("Prisma instance not found on req.prisma");
  return req.prisma;
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

exports.create = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    const userId = req.user?.id;
    if (!producerOrgId || !userId) {
      return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    }
    const body = req.body ?? {};
    const category = body.category ?? "OTHER";
    const priority = body.priority ?? "MEDIUM";
    const subject = (body.subject || "").trim();
    const description = (body.description || "").trim();
    if (!subject) {
      return res.status(400).json(errorEnvelope("VALIDATION", "Subject is required", undefined, getTraceId(req)));
    }
    const ticket = await service.createTicket(prisma, {
      producerOrgId,
      createdByUserId: userId,
      category,
      priority,
      subject,
      description,
      relatedEntityType: body.relatedEntityType ?? null,
      relatedEntityId: body.relatedEntityId ?? null,
      consentToViewData: !!body.consentToViewData,
    });
    try {
      const { notifyMany } = require("../../services/notification.service");
      const adminUsers = await prisma.userGlobalRole.findMany({
        where: { role: { key: "PLATFORM_ADMIN" } },
        select: { userId: true },
        distinct: ["userId"],
      });
      const adminIds = adminUsers.map((u) => u.userId);
      if (adminIds.length > 0) {
        await notifyMany(adminIds, {
          type: "TICKET_CREATED",
          title: `New ticket: ${ticket.ticketNo}`,
          message: subject.slice(0, 120),
          actionUrl: `/admin/support/tickets/${ticket.id}`,
          priority: "P1",
          source: "producer",
          meta: { ticketId: ticket.id, ticketNo: ticket.ticketNo, producerOrgId },
        });
      }
    } catch (_) {
      // notification best-effort
    }
    return res.status(201).json(successEnvelope(ticket, "Ticket created", "CREATED", getTraceId(req)));
  } catch (e: any) {
    const status = e?.statusCode ?? 500;
    return res.status(status).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Create failed", undefined, getTraceId(req)));
  }
};

exports.list = async (req: any, res: any) => {
  try {
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) {
      return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    }
    const params = {
      producerOrgId,
      status: req.query?.status ? String(req.query.status) : undefined,
      priority: req.query?.priority ? String(req.query.priority) : undefined,
      category: req.query?.category ? String(req.query.category) : undefined,
      page: toInt(req.query?.page) ?? 1,
      pageSize: toInt(req.query?.pageSize) ?? toInt(req.query?.limit) ?? 20,
    };
    const data = await service.listTickets(prisma, params);
    return res.json(successEnvelope(data, "Tickets list", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "List failed", undefined, getTraceId(req)));
  }
};

exports.getOne = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    const ticket = await service.getTicketDetail(prisma, id, producerOrgId);
    if (!ticket) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, getTraceId(req)));
    return res.json(successEnvelope(ticket, "Ticket detail", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Fetch failed", undefined, getTraceId(req)));
  }
};

exports.reply = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    const userId = req.user?.id;
    if (!producerOrgId || !userId) return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    const message = (req.body?.message ?? "").trim();
    if (!message) return res.status(400).json(errorEnvelope("VALIDATION", "Message is required", undefined, getTraceId(req)));
    const msg = await service.addMessage(prisma, { ticketId: id, producerOrgId, senderUserId: userId, message });
    if (!msg) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, getTraceId(req)));
    return res.status(201).json(successEnvelope(msg, "Reply added", "CREATED", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Reply failed", undefined, getTraceId(req)));
  }
};

exports.close = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    const userId = req.user?.id;
    if (!producerOrgId || !userId) return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    const updated = await service.closeTicket(prisma, id, producerOrgId, userId);
    if (!updated) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, getTraceId(req)));
    return res.json(successEnvelope(updated, "Ticket closed", "OK", getTraceId(req)));
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Close failed", undefined, getTraceId(req)));
  }
};

exports.reopen = async (req: any, res: any) => {
  try {
    const id = toInt(req.params?.id);
    if (id == null) return res.status(400).json(errorEnvelope("INVALID_ID", "Invalid ticket id", undefined, getTraceId(req)));
    const prisma = getPrisma(req);
    const producerOrgId = req.producerOrgId;
    const userId = req.user?.id;
    if (!producerOrgId || !userId) return res.status(401).json(errorEnvelope("UNAUTHORIZED", "Producer context required", undefined, getTraceId(req)));
    const updated = await service.reopenTicket(prisma, id, producerOrgId, userId);
    if (!updated) return res.status(404).json(errorEnvelope("NOT_FOUND", "Ticket not found", { id }, getTraceId(req)));
    return res.json(successEnvelope(updated, "Ticket reopened", "OK", getTraceId(req)));
  } catch (e: any) {
    const status = e?.statusCode ?? 400;
    return res.status(status).json(errorEnvelope(e?.code ?? "ERROR", e?.message ?? "Reopen failed", undefined, getTraceId(req)));
  }
};
