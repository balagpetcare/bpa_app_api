/**
 * Pure query-builder for GET /admin/incidents list filters.
 * Tested in isolation to avoid controller-level redeclaration when running with other suites.
 */

export type IncidentsListQuery = {
  producerOrgId?: string | number | null;
  entityType?: string | null;
  entityId?: string | number | null;
  incidentType?: string | null;
  severity?: string | null;
  actionTaken?: string | null;
  resolved?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  q?: string | null;
};

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build Prisma where clause for GovernanceIncident list. All filters are optional and additive.
 */
export function buildIncidentsWhereClause(query: IncidentsListQuery): Record<string, unknown> {
  const producerOrgId = toInt(query.producerOrgId);
  const entityType = query.entityType ? String(query.entityType) : null;
  const entityId = toInt(query.entityId);
  const incidentType = query.incidentType ? String(query.incidentType) : null;
  const severity = query.severity ? String(query.severity) : null;
  const actionTaken = query.actionTaken ? String(query.actionTaken) : null;
  const resolved =
    query.resolved === "true" ? true : query.resolved === "false" ? false : null;
  const dateFrom = parseDate(query.dateFrom);
  const dateTo = parseDate(query.dateTo);
  const q =
    typeof query.q === "string" ? query.q.trim().slice(0, 200) : null;

  const where: Record<string, unknown> = {};
  if (producerOrgId != null) where.producerOrgId = producerOrgId;
  if (entityType) where.entityType = entityType;
  if (entityId != null) where.entityId = entityId;
  if (incidentType) where.incidentType = incidentType;
  if (severity) where.severity = severity;
  if (actionTaken) where.actionTaken = actionTaken;
  if (resolved === true) where.resolvedAt = { not: null };
  if (resolved === false) where.resolvedAt = null;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = dateFrom;
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = dateTo;
  }
  if (q) {
    where.OR = [
      { reason: { contains: q, mode: "insensitive" } },
      { ticketId: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}
