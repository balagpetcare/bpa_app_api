/**
 * Producer support tickets: create, list, detail, reply, close, reopen.
 * All operations are scoped to producerOrgId.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { TicketCategory, TicketPriority } from "@prisma/client";

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Generate human-readable ticket number: T-YYYY-NNNNNN */
async function generateTicketNo(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `T-${year}-`;
  const existing = await prisma.supportTicket.findMany({
    where: { ticketNo: { startsWith: prefix } },
    select: { ticketNo: true },
    orderBy: { id: "desc" },
    take: 1,
  });
  const nextNum = existing.length === 0 ? 1 : parseInt(existing[0].ticketNo.slice(prefix.length), 10) + 1;
  return `${prefix}${String(nextNum).padStart(6, "0")}`;
}

export type CreateTicketInput = {
  producerOrgId: number;
  createdByUserId: number;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  consentToViewData?: boolean;
};

export async function createTicket(prisma: PrismaClient, input: CreateTicketInput) {
  const ticketNo = await generateTicketNo(prisma);
  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNo,
      producerOrgId: input.producerOrgId,
      createdByUserId: input.createdByUserId,
      category: input.category,
      priority: input.priority,
      subject: (input.subject || "").trim().slice(0, 512),
      description: (input.description || "").trim(),
      relatedEntityType: input.relatedEntityType?.trim().slice(0, 32) ?? null,
      relatedEntityId: input.relatedEntityId?.trim().slice(0, 128) ?? null,
      consentToViewData: input.consentToViewData ?? false,
    },
    include: {
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
      producerOrg: { select: { id: true, name: true } },
    },
  });
  return ticket;
}

export type ListTicketsParams = {
  producerOrgId: number;
  status?: string;
  priority?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

export async function listTickets(prisma: PrismaClient, params: ListTicketsParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.SupportTicketWhereInput = {
    producerOrgId: params.producerOrgId,
  };
  if (params.status) where.status = params.status as any;
  if (params.priority) where.priority = params.priority as any;
  if (params.category) where.category = params.category as TicketCategory;

  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
      include: {
        assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getTicketDetail(prisma: PrismaClient, ticketId: number, producerOrgId: number) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, producerOrgId },
    include: {
      createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
      producerOrg: { select: { id: true, name: true } },
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        include: {
          sender: { select: { id: true, profile: { select: { displayName: true } } } },
          attachments: { select: { id: true, fileName: true, fileKey: true, mimeType: true, fileSize: true } },
        },
      },
    },
  });
  return ticket;
}

export type AddMessageInput = {
  ticketId: number;
  producerOrgId: number;
  senderUserId: number;
  message: string;
  isInternal?: boolean;
};

export async function addMessage(prisma: PrismaClient, input: AddMessageInput) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: input.ticketId, producerOrgId: input.producerOrgId },
    select: { id: true, status: true },
  });
  if (!ticket) return null;

  const msg = await prisma.ticketMessage.create({
    data: {
      ticketId: input.ticketId,
      senderType: "PRODUCER",
      senderUserId: input.senderUserId,
      message: (input.message || "").trim(),
      isInternal: input.isInternal ?? false,
    },
    include: {
      sender: { select: { id: true, profile: { select: { displayName: true } } } },
      attachments: true,
    },
  });
  return msg;
}

export async function closeTicket(prisma: PrismaClient, ticketId: number, producerOrgId: number, userId: number) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, producerOrgId },
    select: { id: true, status: true, closedAt: true },
  });
  if (!ticket) return null;
  if (ticket.status === "CLOSED" || ticket.status === "RESOLVED") return ticket;

  const now = new Date();
  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: "RESOLVED", resolvedAt: now, closedAt: now, updatedAt: now },
    include: {
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });

  await prisma.ticketAuditEvent.create({
    data: {
      ticketId,
      eventType: "CLOSED",
      actorUserId: userId,
      meta: { by: "producer" },
    },
  });
  return updated;
}

const REOPEN_DAYS = 7;

export async function reopenTicket(prisma: PrismaClient, ticketId: number, producerOrgId: number, userId: number) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, producerOrgId },
    select: { id: true, status: true, closedAt: true },
  });
  if (!ticket) return null;
  if (ticket.status !== "RESOLVED" && ticket.status !== "CLOSED") return ticket;

  const closedAt = ticket.closedAt ? new Date(ticket.closedAt) : null;
  if (closedAt) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - REOPEN_DAYS);
    if (closedAt < cutoff) throw Object.assign(new Error("Ticket cannot be reopened after 7 days"), { statusCode: 400 });
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: "OPEN", resolvedAt: null, closedAt: null, updatedAt: new Date() },
    include: {
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });

  await prisma.ticketAuditEvent.create({
    data: {
      ticketId,
      eventType: "REOPENED",
      actorUserId: userId,
      meta: { by: "producer" },
    },
  });
  return updated;
}
