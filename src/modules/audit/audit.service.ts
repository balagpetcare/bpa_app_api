import type { Request } from "express";
import { prisma } from "../../lib/prisma";
import type { AuditEntityType } from "@prisma/client";

export type AuditParams = {
  req: Request;
  action: string;
  entityType: AuditEntityType;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  branchId?: number;
  orgId?: number;
  metadata?: Record<string, unknown>;
};

export async function logAudit(p: AuditParams) {
  // @ts-ignore
  const auth = p.req.auth || undefined;

  const ip =
    (p.req.headers["x-forwarded-for"] as string) ||
    p.req.socket.remoteAddress ||
    null;

  const ua = p.req.headers["user-agent"] || null;
  const requestId = (p.req.headers["x-request-id"] as string) || null;

  const orgId = p.orgId ?? auth?.orgId ?? null;
  const branchId = p.branchId ?? null;
  const actorId = auth?.staffId ?? null;

  return prisma.auditLog.create({
    data: ({
      actorId,
      action: p.action,
      entityType: p.entityType,
      entityId: String(p.entityId),
      before: p.before as any,
      after: p.after as any,
      metadata: {
        ip,
        ua,
        requestId,
        ...(p.metadata || {}),
      },
    } as any),
  });
}