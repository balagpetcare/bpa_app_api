/**
 * Producer Governance: audit event logging (AuditEvent table).
 * Every admin mutation must create an AuditEvent. Use traceId from request.
 */

import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type CreateAuditEventPayload = {
  actorUserId?: number | null;
  actorRole: string;
  actionKey: string;
  entityType: string;
  entityId?: string | null;
  orgId?: number | null;
  metadata?: Record<string, unknown> | null;
  traceId?: string | null;
  ip?: string | null;
};

/**
 * Create a single AuditEvent row. Call from service layer only (no controller Prisma).
 */
export async function createAuditEvent(
  prisma: PrismaClient,
  payload: CreateAuditEventPayload
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorUserId: payload.actorUserId ?? undefined,
      actorRole: payload.actorRole.slice(0, 64),
      actionKey: payload.actionKey.slice(0, 128),
      entityType: payload.entityType.slice(0, 64),
      entityId: payload.entityId ? String(payload.entityId).slice(0, 128) : null,
      orgId: payload.orgId ?? undefined,
      metadata: (payload.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      traceId: payload.traceId ? String(payload.traceId).slice(0, 128) : null,
      ip: payload.ip ? String(payload.ip).slice(0, 64) : null,
    },
  });
}
