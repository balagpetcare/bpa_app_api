/**
 * Admin Producer Governance: list/get producers, suspend/unsuspend, flags, quotas, audit.
 * Service layer only; no Prisma in controller.
 */

import type { PrismaClient } from "@prisma/client";
import * as auditGov from "../../services/governance/auditGovernance.service";
import * as featureFlag from "../../services/governance/featureFlag.service";
import * as quota from "../../services/governance/quota.service";

export type ListProducersParams = {
  status?: string;
  kycStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listProducers(prisma: PrismaClient, params: ListProducersParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.kycStatus) where.status = params.kycStatus;
  if (params.search && params.search.trim()) {
    where.OR = [
      { name: { contains: params.search.trim(), mode: "insensitive" } },
      { owner: { auth: { email: { contains: params.search.trim(), mode: "insensitive" } } } },
      { owner: { auth: { phone: { contains: params.search.trim() } } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.producerOrg.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
      include: {
        owner: {
          select: {
            id: true,
            profile: { select: { displayName: true } },
            auth: { select: { email: true, phone: true } },
          },
        },
      },
    }),
    prisma.producerOrg.count({ where }),
  ]);

  const orgIds = items.map((o) => o.id);
  const flagsByOrg =
    orgIds.length > 0
      ? await prisma.orgFeatureFlag.findMany({
          where: { producerOrgId: { in: orgIds }, enabled: false },
          select: { producerOrgId: true, key: true },
        })
      : [];
  const flagsMap = new Map<number, string[]>();
  for (const f of flagsByOrg) {
    const arr = flagsMap.get(f.producerOrgId) ?? [];
    arr.push(`${f.key}=false`);
    flagsMap.set(f.producerOrgId, arr);
  }

  return {
    items: items.map((o) => ({
      orgId: o.id,
      name: o.name,
      status: o.status,
      kycStatus: o.status,
      owner: o.owner
        ? {
            userId: o.owner.id,
            name: (o.owner as { profile?: { displayName?: string } }).profile?.displayName ?? null,
            email: (o.owner as { auth?: { email?: string; phone?: string } }).auth?.email ?? null,
          }
        : null,
      lastActivityAt: o.updatedAt,
      flagsSummary: flagsMap.get(o.id) ?? [],
    })),
    page,
    pageSize,
    total,
  };
}

export async function getProducerDetail(prisma: PrismaClient, orgId: number) {
  const org = await prisma.producerOrg.findUnique({
    where: { id: orgId },
    include: {
      owner: { select: { id: true, profile: true, auth: true } },
    },
  });
  if (!org) return null;

  const [pendingApprovals, flags, quotas] = await Promise.all([
    prisma.producerApproval.count({ where: { producerOrgId: orgId, status: "SUBMITTED" } }),
    featureFlag.getFlags(prisma, orgId),
    quota.getQuotas(prisma, orgId),
  ]);

  const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const printsToday = await prisma.producerAuditLog.count({
    where: {
      producerOrgId: orgId,
      action: "BATCH_PRINTED",
      createdAt: { gte: dayStart },
    },
  });

  return {
    orgId: org.id,
    name: org.name,
    status: org.status,
    kycStatus: org.status,
    ownerUserId: org.ownerUserId,
    createdAt: org.createdAt,
    lastActivityAt: org.updatedAt,
    metrics: { pendingApprovals, printsToday, batchCreatesToday: 0 },
    owner: org.owner,
    flags,
    quotas,
  };
}

export async function suspendProducer(
  prisma: PrismaClient,
  orgId: number,
  actorUserId: number,
  actorRole: string,
  reason?: string | null,
  traceId?: string | null,
  ip?: string | null
) {
  const org = await prisma.producerOrg.findUnique({ where: { id: orgId } });
  if (!org) return null;
  if (org.status === "SUSPENDED") return { updated: org, incidentId: null };

  let incidentId: number | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.producerOrg.update({
      where: { id: orgId },
      data: { status: "SUSPENDED" },
    });
    const incident = await tx.governanceIncident.create({
      data: {
        entityType: "PRODUCER_ORG",
        entityId: orgId,
        producerOrgId: orgId,
        incidentType: "POLICY_VIOLATION",
        severity: "HIGH",
        actionTaken: "SUSPENDED",
        reason: reason ?? "Suspended by admin",
        createdByUserId: actorUserId,
      },
    });
    incidentId = incident.id;
    return o;
  });
  await auditGov.createAuditEvent(prisma, {
    actorUserId,
    actorRole,
    actionKey: "admin.producer.suspend",
    entityType: "PRODUCER_ORG",
    entityId: String(orgId),
    orgId,
    metadata: { reason: reason ?? null, incidentId },
    traceId,
    ip,
  });
  return { updated, incidentId };
}

export async function unsuspendProducer(
  prisma: PrismaClient,
  orgId: number,
  actorUserId: number,
  actorRole: string,
  reason?: string | null,
  traceId?: string | null,
  ip?: string | null
) {
  const org = await prisma.producerOrg.findUnique({ where: { id: orgId } });
  if (!org) return null;
  if (org.status !== "SUSPENDED") return { updated: org, incidentId: null };

  let incidentId: number | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.producerOrg.update({
      where: { id: orgId },
      data: { status: "VERIFIED" },
    });
    const incident = await tx.governanceIncident.create({
      data: {
        entityType: "PRODUCER_ORG",
        entityId: orgId,
        producerOrgId: orgId,
        incidentType: "RESTORATION",
        severity: "LOW",
        actionTaken: "UNSUSPENDED",
        reason: reason ?? "Unsuspended by admin",
        createdByUserId: actorUserId,
      },
    });
    incidentId = incident.id;
    return o;
  });
  await auditGov.createAuditEvent(prisma, {
    actorUserId,
    actorRole,
    actionKey: "admin.producer.unsuspend",
    entityType: "PRODUCER_ORG",
    entityId: String(orgId),
    orgId,
    metadata: { reason: reason ?? null, incidentId },
    traceId,
    ip,
  });
  return { updated, incidentId };
}

export type AuditEventsParams = {
  limit?: number;
  offset?: number;
  entityType?: string;
  actionKey?: string;
  fromDate?: string; // ISO date or datetime
  toDate?: string;
};

export async function getAuditEvents(
  prisma: PrismaClient,
  orgId: number,
  params: AuditEventsParams
) {
  const limit = Math.min(200, params.limit ?? 50);
  const offset = params.offset ?? 0;
  const where: { orgId: number; entityType?: string; actionKey?: string; createdAt?: { gte?: Date; lte?: Date } } = { orgId };
  if (params.entityType) where.entityType = params.entityType;
  if (params.actionKey) where.actionKey = params.actionKey;
  if (params.fromDate || params.toDate) {
    where.createdAt = {};
    if (params.fromDate) {
      const from = new Date(params.fromDate);
      if (!Number.isNaN(from.getTime())) where.createdAt.gte = from;
    }
    if (params.toDate) {
      const to = new Date(params.toDate);
      if (!Number.isNaN(to.getTime())) {
        to.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }
  }

  const items = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: offset,
  });
  return { items };
}

/** Phase 3: metrics for producer org (counts, usage, recent activity). Multi-tenant: orgId only. */
export async function getProducerMetrics(prisma: PrismaClient, orgId: number) {
  const org = await prisma.producerOrg.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true, updatedAt: true },
  });
  if (!org) return null;

  const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const [pendingApprovals, printsToday, batchCreatesToday, staffCount, auditCountLast24h, quotaRows] = await Promise.all([
    prisma.producerApproval.count({ where: { producerOrgId: orgId, status: "SUBMITTED" } }),
    prisma.producerAuditLog.count({
      where: { producerOrgId: orgId, action: "BATCH_PRINTED", createdAt: { gte: dayStart } },
    }),
    prisma.authBatch.count({
      where: { authProduct: { producerOrgId: orgId }, createdAt: { gte: dayStart } },
    }),
    prisma.producerOrgStaff.count({ where: { producerOrgId: orgId } }),
    prisma.auditEvent.count({
      where: { orgId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.orgQuota.findMany({ where: { producerOrgId: orgId }, select: { key: true, limit: true, used: true } }),
  ]);

  const usage = quotaRows.map((q) => ({ key: q.key, limit: q.limit, used: q.used }));

  return {
    orgId: org.id,
    name: org.name,
    status: org.status,
    lastActivityAt: org.updatedAt,
    counts: {
      pendingApprovals,
      printsToday,
      batchCreatesToday,
      staffCount,
      auditEventsLast24h: auditCountLast24h,
    },
    usage,
  };
}

/** Phase 3: print jobs (audit-based from ProducerAuditLog BATCH_PRINTED/BATCH_REPRINTED). Multi-tenant: orgId only. */
export async function getPrintJobs(
  prisma: PrismaClient,
  orgId: number,
  params: { limit?: number; offset?: number; fromDate?: string; toDate?: string }
) {
  const org = await prisma.producerOrg.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return null;

  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = params.offset ?? 0;
  const where: { producerOrgId: number; action: { in: string[] }; createdAt?: { gte?: Date; lte?: Date } } = {
    producerOrgId: orgId,
    action: { in: ["BATCH_PRINTED", "BATCH_REPRINTED"] },
  };
  if (params.fromDate) {
    const from = new Date(params.fromDate);
    if (!Number.isNaN(from.getTime())) {
      where.createdAt = where.createdAt ?? {};
      (where.createdAt as { gte?: Date }).gte = from;
    }
  }
  if (params.toDate) {
    const to = new Date(params.toDate);
    if (!Number.isNaN(to.getTime())) {
      to.setUTCHours(23, 59, 59, 999);
      where.createdAt = where.createdAt ?? {};
      (where.createdAt as { lte?: Date }).lte = to;
    }
  }

  const items = await prisma.producerAuditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: offset,
  });

  return {
    items: items.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorType: r.actorType,
      actorId: r.actorId,
      createdAt: r.createdAt,
    })),
    total: await prisma.producerAuditLog.count({ where }),
  };
}
