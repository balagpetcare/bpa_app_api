/**
 * Room Audit – human-readable audit trail for clinic rooms.
 * Reads from AuditLog (entityType BRANCH, entityId branchId:room:roomId).
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

function label(val: any): string {
  if (val == null) return "—";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return String(val);
}

/** Turn one audit log row into a single human-readable summary (no raw JSON). */
function toSummaryText(row: { action: string; before?: any; after?: any }): string {
  const before = row.before as Record<string, unknown> | null;
  const after = row.after as Record<string, unknown> | null;
  const a = after ?? {};
  const b = before ?? {};

  switch (row.action) {
    case "CLINIC_ROOM_CREATE":
      return `Room "${label(a.name)}" created. Type: ${label(a.roomType)}, status: ${label(a.status)}.`;
    case "CLINIC_ROOM_UPDATE": {
      const parts: string[] = [];
      if (a.name !== undefined && a.name !== b.name) parts.push(`name → "${label(a.name)}"`);
      if (a.roomType !== undefined && a.roomType !== b.roomType) parts.push(`type → ${label(a.roomType)}`);
      if (a.status !== undefined && a.status !== b.status) parts.push(`status → ${label(a.status)}`);
      if (a.operationalStatus !== undefined && a.operationalStatus !== b.operationalStatus) parts.push(`operational status → ${label(a.operationalStatus)}`);
      if (parts.length) return `Room updated. ${parts.join("; ")}.`;
      return "Room updated.";
    }
    case "CLINIC_ROOM_DEACTIVATE":
      return `Room deactivated.`;
    default:
      return `Room: ${row.action}.`;
  }
}

export type RoomAuditEntry = {
  id: number;
  action: string;
  summaryText: string;
  actorId: string;
  createdAt: string;
};

/** Get room audit log as human-readable entries (no raw JSON). */
export async function getRoomAudit(branchId: number, roomId: number, limit = 50): Promise<RoomAuditEntry[]> {
  const entityId = `${branchId}:room:${roomId}`;
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "BRANCH", entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, before: true, after: true, actorId: true, createdAt: true },
  });
  return rows.map((r: any) => ({
    id: r.id,
    action: r.action,
    summaryText: toSummaryText({ action: r.action, before: r.before, after: r.after }),
    actorId: r.actorId,
    createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
  }));
}
