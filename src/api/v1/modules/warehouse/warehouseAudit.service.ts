import type { WarehouseAuditCategory } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

export type WarehouseAuditLogInput = {
  orgId: number;
  warehouseId?: number | null;
  category: WarehouseAuditCategory;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: object | null;
  actorUserId?: number | null;
};

/** Merge request correlation (X-Request-Id / X-Correlation-Id) into audit metadata for traceability. */
export function auditMetadataFromRequest(
  req: { headers?: Record<string, string | string[] | undefined>; ip?: string },
  base?: Record<string, unknown> | null
): Record<string, unknown> {
  const raw =
    req.headers?.["x-request-id"] ??
    req.headers?.["X-Request-Id"] ??
    req.headers?.["x-correlation-id"] ??
    req.headers?.["X-Correlation-Id"];
  const requestId = Array.isArray(raw) ? raw[0] : raw;
  const out: Record<string, unknown> = { ...(base ?? {}) };
  if (typeof requestId === "string" && requestId.trim()) {
    out.requestId = requestId.trim();
  }
  if (req.ip) {
    out.clientIp = req.ip;
  }
  return out;
}

/** Fire-and-forget audit row (outside an interactive transaction). */
export async function logWarehouseAudit(data: WarehouseAuditLogInput) {
  return prisma.warehouseAuditEvent.create({
    data: {
      orgId: data.orgId,
      warehouseId: data.warehouseId ?? null,
      category: data.category,
      action: data.action,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? undefined,
      actorUserId: data.actorUserId ?? null,
    },
  });
}

export async function logWarehouseAuditInTx(
  tx: { warehouseAuditEvent: { create: (args: unknown) => Promise<unknown> } },
  data: WarehouseAuditLogInput
) {
  return (tx as any).warehouseAuditEvent.create({
    data: {
      orgId: data.orgId,
      warehouseId: data.warehouseId ?? null,
      category: data.category,
      action: data.action,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? undefined,
      actorUserId: data.actorUserId ?? null,
    },
  });
}

export async function listAuditEventsForExport(params: {
  orgId: number;
  warehouseId?: number;
  categories?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const limit = Math.min(params.limit ?? 5000, 20000);
  const where: Record<string, unknown> = { orgId: params.orgId };
  if (params.warehouseId != null) where.warehouseId = params.warehouseId;
  if (params.categories?.length) {
    where.category = { in: params.categories };
  }
  if (params.from || params.to) {
    const createdAt: Record<string, Date> = {};
    if (params.from) createdAt.gte = params.from;
    if (params.to) createdAt.lte = params.to;
    where.createdAt = createdAt;
  }
  return prisma.warehouseAuditEvent.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, auth: { select: { email: true } } } },
    },
  });
}

export function auditRowsToCsv(rows: Awaited<ReturnType<typeof listAuditEventsForExport>>): string {
  const headers = ["id", "createdAt", "category", "action", "entityType", "entityId", "warehouseId", "actorId", "actorEmail", "metadata"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.createdAt.toISOString(),
        r.category,
        r.action,
        r.entityType ?? "",
        r.entityId ?? "",
        r.warehouseId ?? "",
        r.actorUserId ?? "",
        (r as any).actor?.auth?.email ?? "",
        esc(JSON.stringify(r.metadata ?? {})),
      ].join(",")
    );
  }
  return lines.join("\n");
}
