/**
 * Owner Staff Control Service
 * Used by Owner panel Staff Control Dashboard: list staff (exclude owners), detail,
 * status/role/permissions/shift updates, force-logout, transfer, audit, activity summary.
 * All operations scoped to organizations owned by ownerUserId.
 */

import { PrismaClient, MemberRole } from "@prisma/client";

const prisma = require("../../../infrastructure/db/prismaClient").default as PrismaClient;

/** Org IDs owned by this owner (for scoping). */
export async function getOwnerOrgIds(ownerUserId: number): Promise<number[]> {
  const orgs = await prisma.organization.findMany({
    where: { ownerUserId },
    select: { id: true },
  });
  return orgs.map((o) => o.id);
}

/** User IDs that are org owners in these orgs (exclude from staff list). */
async function getOwnerUserIdsInOrgs(orgIds: number[]): Promise<number[]> {
  if (orgIds.length === 0) return [];
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { ownerUserId: true },
  });
  return [...new Set(orgs.map((o) => o.ownerUserId).filter(Boolean))];
}

/** Resolve one reporting manager (BRANCH_MANAGER) per branchId. */
async function getReportingManagersByBranch(
  branchIds: number[]
): Promise<Map<number, { userId: number; displayName: string | null; email: string | null }>> {
  if (branchIds.length === 0) return new Map();
  const managers = await prisma.branchMember.findMany({
    where: { branchId: { in: branchIds }, role: MemberRole.BRANCH_MANAGER, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
    },
  });
  const byBranch = new Map<number, { userId: number; displayName: string | null; email: string | null }>();
  for (const m of managers) {
    const b = m as any;
    if (!byBranch.has(b.branchId)) {
      byBranch.set(b.branchId, {
        userId: b.userId,
        displayName: b.user?.profile?.displayName ?? null,
        email: b.user?.auth?.email ?? null,
      });
    }
  }
  return byBranch;
}

/** List staff for control dashboard: one row per user, exclude org owners. */
export async function listStaffForOwner(
  ownerUserId: number,
  filters: { branchId?: number; role?: string; status?: string; lastActiveFrom?: string } = {}
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) return { items: [], total: 0 };

  const ownerUserIds = await getOwnerUserIdsInOrgs(orgIds);

  const where: any = {
    orgId: { in: orgIds },
    userId: { notIn: ownerUserIds },
  };
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.role) {
    const r = String(filters.role).toUpperCase().replace(/\s+/g, "_");
    if (r) where.role = r;
  }
  if (filters.status) {
    const s = String(filters.status).toUpperCase();
    if (["ACTIVE", "SUSPENDED", "INVITED"].includes(s)) where.status = s;
  }

  const members = await prisma.branchMember.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          status: true,
          auth: { select: { email: true, phone: true, lastLoginAt: true } },
          profile: { select: { displayName: true, username: true } },
        },
      },
    },
  });

  const userIds = [...new Set(members.map((m) => m.userId))];
  const lastLoginMap = new Map<number, Date | null>();
  const authRows = await prisma.userAuth.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, lastLoginAt: true },
  });
  authRows.forEach((a) => lastLoginMap.set(a.userId, a.lastLoginAt));

  const branchIds = [...new Set(members.map((m) => m.branchId))];
  const reportingByBranch = await getReportingManagersByBranch(branchIds);

  const byUser = new Map<
    number,
    {
      userId: number;
      user: (typeof members)[0]["user"];
      branches: {
        branchId: number;
        branchName: string;
        orgName: string;
        status: string;
        role: string;
        memberId: number;
        reportingManager: { userId: number; displayName: string | null; email: string | null } | null;
      }[];
      status: string;
      lastLoginAt: string | null;
    }
  >();

  for (const m of members) {
    const lastLogin = (m.user?.auth as any)?.lastLoginAt ?? lastLoginMap.get(m.userId) ?? null;
    const lastLoginStr = lastLogin ? (lastLogin as Date).toISOString() : null;
    const reporting = reportingByBranch.get(m.branchId) ?? null;
    const branchInfo = {
      branchId: m.branchId,
      branchName: (m.branch as any)?.name ?? "",
      orgName: (m.org as any)?.name ?? "",
      status: m.status,
      role: m.role,
      memberId: m.id,
      reportingManager: reporting,
    };
    const existing = byUser.get(m.userId);
    if (existing) {
      existing.branches.push(branchInfo);
      if (m.status === "SUSPENDED") existing.status = "SUSPENDED";
      if (lastLoginStr && (!existing.lastLoginAt || lastLoginStr > existing.lastLoginAt)) existing.lastLoginAt = lastLoginStr;
    } else {
      byUser.set(m.userId, {
        userId: m.userId,
        user: m.user as any,
        branches: [branchInfo],
        status: m.status,
        lastLoginAt: lastLoginStr,
      });
    }
  }

  let items = Array.from(byUser.values());
  if (filters.lastActiveFrom) {
    const from = new Date(filters.lastActiveFrom);
    if (!Number.isNaN(from.getTime())) {
      items = items.filter((i) => {
        const t = i.lastLoginAt ? new Date(i.lastLoginAt) : null;
        return t && t >= from;
      });
    }
  }
  return { items, total: items.length };
}

/** Get one staff user detail (by userId) for owner. */
export async function getStaffDetailForOwner(ownerUserId: number, staffUserId: number) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) return null;

  const ownerUserIds = await getOwnerUserIdsInOrgs(orgIds);
  if (ownerUserIds.includes(staffUserId)) return null;

  const members = await prisma.branchMember.findMany({
    where: { userId: staffUserId, orgId: { in: orgIds } },
    include: {
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          status: true,
          auth: { select: { email: true, phone: true, lastLoginAt: true } },
          profile: { select: { displayName: true, username: true } },
        },
      },
    },
  });
  if (members.length === 0) return null;

  const branchIds = members.map((m) => m.branchId);
  const perms = await prisma.branchAccessPermission.findMany({
    where: { userId: staffUserId, branchId: { in: branchIds } },
    include: { branch: { select: { id: true, name: true } } },
  });
  const reportingByBranch = await getReportingManagersByBranch(branchIds);

  const auth = await prisma.userAuth.findUnique({
    where: { userId: staffUserId },
    select: { lastLoginAt: true },
  });

  return {
    user: members[0].user,
    memberships: members.map((m) => ({
      ...m,
      reportingManager: reportingByBranch.get(m.branchId) ?? null,
    })),
    branchAccess: perms,
    lastLoginAt: (members[0].user?.auth as any)?.lastLoginAt ?? auth?.lastLoginAt ?? null,
  };
}

/** Update staff status (BranchMember + BranchAccessPermission SUSPENDED). */
export async function updateStaffStatus(
  ownerUserId: number,
  staffUserId: number,
  status: "ACTIVE" | "SUSPENDED"
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) throw new Error("No organizations");

  const members = await prisma.branchMember.findMany({
    where: { userId: staffUserId, orgId: { in: orgIds } },
    select: { id: true, branchId: true },
  });
  if (members.length === 0) throw new Error("Staff not found");

  await prisma.$transaction([
    prisma.branchMember.updateMany({
      where: { userId: staffUserId, orgId: { in: orgIds } },
      data: { status },
    }),
    prisma.branchAccessPermission.updateMany({
      where: {
        userId: staffUserId,
        branchId: { in: members.map((m) => m.branchId) },
      },
      data: { status: status === "SUSPENDED" ? "SUSPENDED" : "APPROVED" },
    }),
  ]);
  return { ok: true, status };
}

/** Update staff role at a branch (or all branches for this user in owner's orgs). */
export async function updateStaffRole(
  ownerUserId: number,
  staffUserId: number,
  role: string,
  branchId?: number
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) throw new Error("No organizations");

  const where: any = { userId: staffUserId, orgId: { in: orgIds } };
  if (branchId) where.branchId = branchId;

  const members = await prisma.branchMember.findMany({ where, select: { id: true, branchId: true } });
  if (members.length === 0) throw new Error("Staff not found");

  const roleNorm = String(role).toUpperCase().replace(/\s+/g, "_") as MemberRole;
  await prisma.branchMember.updateMany({ where, data: { role: roleNorm } });
  await prisma.branchAccessPermission.updateMany({
    where: { userId: staffUserId, branchId: { in: members.map((m) => m.branchId) } },
    data: { role: roleNorm },
  });
  return { ok: true, role: roleNorm };
}

/** Update permission overrides and/or login window (shift rules) for staff. */
export async function updateStaffPermissions(
  ownerUserId: number,
  staffUserId: number,
  payload: {
    branchId?: number;
    permissionOverrides?: string[] | null;
    loginWindowStart?: string | null;
    loginWindowEnd?: string | null;
  }
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) throw new Error("No organizations");

  const branchIds = payload.branchId
    ? [payload.branchId]
    : (await prisma.branchMember.findMany({
        where: { userId: staffUserId, orgId: { in: orgIds } },
        select: { branchId: true },
      })).map((m) => m.branchId);

  const data: any = {};
  if (payload.permissionOverrides !== undefined) data.permissionOverrides = payload.permissionOverrides;
  if (payload.loginWindowStart !== undefined) data.loginWindowStart = payload.loginWindowStart || null;
  if (payload.loginWindowEnd !== undefined) data.loginWindowEnd = payload.loginWindowEnd || null;

  if (Object.keys(data).length === 0) return { ok: true };
  const result = await prisma.branchAccessPermission.updateMany({
    where: { userId: staffUserId, branchId: { in: branchIds } },
    data,
  });
  return { ok: true, updated: result.count };
}

/** Force logout: revoke all sessions for this user. */
export async function forceLogoutStaff(userId: number): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Transfer staff from one branch to another (within owner's orgs). */
export async function transferStaffBranch(
  ownerUserId: number,
  staffUserId: number,
  fromBranchId: number,
  toBranchId: number
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) throw new Error("No organizations");

  const fromBranch = await prisma.branch.findFirst({
    where: { id: fromBranchId, orgId: { in: orgIds } },
    select: { id: true, orgId: true },
  });
  const toBranch = await prisma.branch.findFirst({
    where: { id: toBranchId, orgId: { in: orgIds } },
    select: { id: true, orgId: true },
  });
  if (!fromBranch || !toBranch) throw new Error("Branch not found");

  const existingMember = await prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId: fromBranchId, userId: staffUserId } },
    select: { id: true, role: true },
  });
  if (!existingMember) throw new Error("Staff not found in source branch");

  const alreadyInTarget = await prisma.branchMember.findUnique({
    where: { branchId_userId: { branchId: toBranchId, userId: staffUserId } },
  });
  if (alreadyInTarget) throw new Error("Staff already in target branch");

  await prisma.$transaction([
    prisma.branchMember.update({
      where: { id: existingMember.id },
      data: { branchId: toBranchId, orgId: toBranch.orgId },
    }),
    prisma.branchAccessPermission.updateMany({
      where: { userId: staffUserId, branchId: fromBranchId },
      data: { status: "REVOKED", revokedAt: new Date() },
    }),
    prisma.branchAccessPermission.upsert({
      where: {
        branchId_userId: { branchId: toBranchId, userId: staffUserId },
      },
      create: {
        branchId: toBranchId,
        userId: staffUserId,
        status: "APPROVED",
        role: existingMember.role,
        requestedAt: new Date(),
      },
      update: { status: "APPROVED", role: existingMember.role },
    }),
  ]);
  return { ok: true, fromBranchId, toBranchId };
}

/** Audit logs for this staff (actor or entity). */
export async function getStaffAuditLogs(ownerUserId: number, staffUserId: number, limit = 100) {
  await getStaffDetailForOwner(ownerUserId, staffUserId);
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { actorId: String(staffUserId) },
        { entityType: "USER", entityId: String(staffUserId) },
      ],
    },
    take: Math.min(limit, 200),
    orderBy: { createdAt: "desc" },
  });
  return logs;
}

/** Activity summary: orders, stock ledger actions (last 30 days). */
export async function getStaffActivitySummary(ownerUserId: number, staffUserId: number) {
  const detail = await getStaffDetailForOwner(ownerUserId, staffUserId);
  if (!detail) return null;

  const branchIds = detail.memberships.map((m) => m.branchId);
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [orderCount, orderCancelCount, stockLedgerCount] = await Promise.all([
    prisma.order.count({
      where: {
        createdByUserId: staffUserId,
        branchId: branchIds.length ? { in: branchIds } : undefined,
        createdAt: { gte: since },
      },
    }),
    prisma.order.count({
      where: {
        createdByUserId: staffUserId,
        status: "CANCELLED",
        createdAt: { gte: since },
      },
    }),
    prisma.stockLedger.count({
      where: {
        createdByUserId: staffUserId,
        createdAt: { gte: since },
      },
    }),
  ]);

  return {
    last30Days: {
      ordersProcessed: orderCount,
      ordersCancelled: orderCancelCount,
      inventoryActions: stockLedgerCount,
    },
    flags: {
      excessiveCancels: orderCount > 0 && orderCancelCount / orderCount > 0.2,
      noActivity: orderCount === 0 && stockLedgerCount === 0,
    },
  };
}
