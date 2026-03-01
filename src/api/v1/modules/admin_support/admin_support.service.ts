/**
 * Admin support tickets: list, stats, detail, update, reply, internal notes, escalate.
 */

import type { PrismaClient } from "@prisma/client";
import type { TicketStatus, TicketPriority, TicketCategory } from "@prisma/client";
import * as enforcementService from "../admin_enforcement/admin_enforcement.service";

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type ListTicketsParams = {
  status?: string;
  priority?: string;
  category?: string;
  producerOrgId?: number;
  assignedToUserId?: number;
  search?: string;
  dateFrom?: string | Date | null;
  dateTo?: string | Date | null;
  page?: number;
  pageSize?: number;
};

export async function listTickets(prisma: PrismaClient, params: ListTicketsParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.priority) where.priority = params.priority;
  if (params.category) where.category = params.category;
  if (params.producerOrgId != null) where.producerOrgId = params.producerOrgId;
  if (params.assignedToUserId !== undefined) {
    where.assignedToUserId = params.assignedToUserId === null || params.assignedToUserId === "" ? null : Number(params.assignedToUserId);
  }
  if (params.dateFrom) {
    where.createdAt = { ...((where.createdAt as object) || {}), gte: new Date(params.dateFrom as string) };
  }
  if (params.dateTo) {
    where.createdAt = { ...((where.createdAt as object) || {}), lte: new Date(params.dateTo as string) };
  }
  if (params.search && String(params.search).trim()) {
    const q = String(params.search).trim();
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { ticketNo: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { producerOrg: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      include: {
        producerOrg: { select: { id: true, name: true, status: true } },
        createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
        assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getTicketStats(prisma: PrismaClient) {
  const [openCount, urgentCount, slaBreachedCount, ticketsWithFirstAdminReply] = await Promise.all([
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_PRODUCER"] } } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, priority: "URGENT" } }),
    prisma.supportTicket.count({ where: { slaBreachedAt: { not: null }, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.supportTicket.findMany({
      where: { messages: { some: { senderType: "ADMIN" } } },
      select: {
        id: true,
        createdAt: true,
        messages: {
          where: { senderType: "ADMIN" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
  ]);

  let avgFirstResponseHours: number | null = null;
  if (ticketsWithFirstAdminReply.length > 0) {
    const hours = ticketsWithFirstAdminReply
      .filter((t) => t.messages[0])
      .map((t) => (new Date(t.messages[0].createdAt).getTime() - new Date(t.createdAt).getTime()) / (3600 * 1000));
    if (hours.length > 0) {
      avgFirstResponseHours = Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10;
    }
  }

  return {
    openCount,
    urgentCount,
    slaBreachedCount,
    avgFirstResponseHours,
  };
}

export async function getTicketDetail(prisma: PrismaClient, ticketId: number) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      producerOrg: {
        select: {
          id: true,
          name: true,
          status: true,
          ownerUserId: true,
          owner: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true, phone: true } } } },
        },
      },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
      escalatedCase: { select: { id: true, caseNo: true, status: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { id: true, profile: { select: { displayName: true } } } },
          attachments: { select: { id: true, fileName: true, fileKey: true, mimeType: true, fileSize: true } },
        },
      },
      auditEvents: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  return ticket;
}

export type UpdateTicketInput = {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedToUserId?: number | null;
};

export async function updateTicket(
  prisma: PrismaClient,
  ticketId: number,
  input: UpdateTicketInput,
  actorUserId: number
) {
  const existing = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, status: true, assignedToUserId: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.category !== undefined) data.category = input.category;
  if (input.assignedToUserId !== undefined) data.assignedToUserId = input.assignedToUserId;

  if (input.status === "RESOLVED" || input.status === "CLOSED") {
    (data as any).resolvedAt = new Date();
    if (input.status === "CLOSED") (data as any).closedAt = new Date();
  }

  if (Object.keys(data).length === 0) {
    return prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { assignedTo: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: data as any,
    include: {
      producerOrg: { select: { id: true, name: true } },
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });

  if (input.status !== undefined && input.status !== existing.status) {
    await prisma.ticketAuditEvent.create({
      data: { ticketId, eventType: "STATUS_CHANGED", actorUserId, meta: { from: existing.status, to: input.status } },
    });
  }
  if (input.assignedToUserId !== undefined && input.assignedToUserId !== existing.assignedToUserId) {
    await prisma.ticketAuditEvent.create({
      data: { ticketId, eventType: "ASSIGNED", actorUserId, meta: { assignedToUserId: input.assignedToUserId } },
    });
  }
  if (input.priority !== undefined) {
    await prisma.ticketAuditEvent.create({
      data: { ticketId, eventType: "PRIORITY_CHANGED", actorUserId, meta: { priority: input.priority } },
    });
  }
  if (input.category !== undefined) {
    await prisma.ticketAuditEvent.create({
      data: { ticketId, eventType: "CATEGORY_CHANGED", actorUserId, meta: { category: input.category } },
    });
  }

  return updated;
}

export async function addAdminReply(
  prisma: PrismaClient,
  ticketId: number,
  input: { message: string; isInternal?: boolean },
  senderUserId: number
) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, producerOrgId: true } });
  if (!ticket) return null;

  const msg = await prisma.ticketMessage.create({
    data: {
      ticketId,
      senderType: input.isInternal ? "SYSTEM" : "ADMIN",
      senderUserId,
      message: (input.message || "").trim(),
      isInternal: input.isInternal ?? false,
    },
    include: {
      sender: { select: { id: true, profile: { select: { displayName: true } } } },
      attachments: true,
    },
  });

  if (!input.isInternal && ticket.producerOrgId) {
    try {
      const org = await prisma.producerOrg.findUnique({
        where: { id: ticket.producerOrgId },
        select: { ownerUserId: true },
      });
      if (org?.ownerUserId) {
        const { createNotification } = require("../../services/notification.service");
        await createNotification({
          userId: org.ownerUserId,
          type: "TICKET_REPLIED",
          title: "Support replied to your ticket",
          message: (input.message || "").trim().slice(0, 120),
          actionUrl: `/producer/support/tickets/${ticketId}`,
          priority: "P1",
          source: "support",
          meta: { ticketId, ticketNo: (await prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { ticketNo: true } }))?.ticketNo },
        });
      }
    } catch (_) {
      // best-effort
    }
  }

  return msg;
}

export async function escalateToEnforcement(
  prisma: PrismaClient,
  ticketId: number,
  input: { summary?: string; details?: string },
  actorUserId: number
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { producerOrg: { select: { id: true } } },
  });
  if (!ticket) return null;
  if (ticket.escalatedCaseId) {
    const err = new Error("Ticket already escalated") as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "ALREADY_ESCALATED";
    throw err;
  }

  const entityType = ticket.relatedEntityType || "ORG";
  const entityId = ticket.relatedEntityId || String(ticket.producerOrgId);
  const summary = (input.summary || ticket.subject || "Escalated from support ticket").trim().slice(0, 256);
  const details = (input.details || ticket.description || "").trim() || null;

  const caseRecord = await enforcementService.createCase(prisma, {
    source: "ADMIN",
    entityType,
    entityId,
    producerOrgId: ticket.producerOrgId,
    severity: ticket.priority === "URGENT" ? "HIGH" : "MEDIUM",
    summary,
    details,
    createdByUserId: actorUserId,
  });

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: "ESCALATED", escalatedCaseId: caseRecord.id, updatedAt: new Date() },
  });

  await prisma.ticketAuditEvent.create({
    data: {
      ticketId,
      eventType: "ESCALATED",
      actorUserId,
      meta: { caseId: caseRecord.id, caseNo: caseRecord.caseNo },
    },
  });

  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      escalatedCase: { select: { id: true, caseNo: true, status: true } },
      producerOrg: { select: { id: true, name: true } },
    },
  });
}
