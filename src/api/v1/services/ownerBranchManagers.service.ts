/**
 * Owner Branch Managers Service
 * Used by Owner panel to list, control, and audit Branch Managers.
 * All operations are scoped to organizations owned by ownerUserId.
 */

import { PrismaClient, MemberRole } from "@prisma/client";

const prisma = require("../../../infrastructure/db/prismaClient").default as PrismaClient;

/** Get org IDs owned by this owner (for scoping). */
export async function getOwnerOrgIds(ownerUserId: number): Promise<number[]> {
  const orgs = await prisma.organization.findMany({
    where: { ownerUserId },
    select: { id: true },
  });
  return orgs.map((o) => o.id);
}

/** List all branch managers (BranchMember with role BRANCH_MANAGER) in owner's orgs. */
export async function listBranchManagersForOwner(
  ownerUserId: number,
  filters: { branchId?: number; status?: string; lastActiveFrom?: string } = {}
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) return { items: [], total: 0 };

  const where: any = {
    orgId: { in: orgIds },
    role: MemberRole.BRANCH_MANAGER,
  };
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.status) {
    const s = String(filters.status).toUpperCase();
    if (s === "ACTIVE" || s === "SUSPENDED" || s === "INVITED") where.status = s;
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
          auth: {
            select: {
              email: true,
              phone: true,
              lastLoginAt: true,
            },
          },
          profile: {
            select: { displayName: true, username: true },
          },
        },
      },
    },
  });

  // Resolve last login from UserAuth (and optionally from BranchAccessPermission.lastLoginAt)
  const userIds = members.map((m) => m.userId);
  const authRows = await prisma.userAuth.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, lastLoginAt: true },
  });
  const lastLoginByUser = new Map(authRows.map((a) => [a.userId, a.lastLoginAt]));

  // Aggregate by userId so one row per manager (user), with branches[] and worst status
  const byUser = new Map<
    number,
    {
      userId: number;
      user: (typeof members)[0]["user"];
      branches: { branchId: number; branchName: string; orgName: string; status: string }[];
      status: string;
      lastLoginAt: string | null;
      memberIds: number[];
    }
  >();
  for (const m of members) {
    const lastLogin = (m.user?.auth as any)?.lastLoginAt ?? lastLoginByUser.get(m.userId) ?? null;
    const lastLoginStr = lastLogin ? (lastLogin as Date).toISOString() : null;
    const existing = byUser.get(m.userId);
    const branchInfo = {
      branchId: m.branchId,
      branchName: (m.branch as any)?.name ?? "",
      orgName: (m.org as any)?.name ?? "",
      status: m.status,
    };
    if (existing) {
      existing.branches.push(branchInfo);
      existing.memberIds.push(m.id);
      if (m.status === "SUSPENDED") existing.status = "SUSPENDED";
      if (lastLoginStr && (!existing.lastLoginAt || lastLoginStr > existing.lastLoginAt)) {
        existing.lastLoginAt = lastLoginStr;
      }
    } else {
      byUser.set(m.userId, {
        userId: m.userId,
        user: m.user as any,
        branches: [branchInfo],
        status: m.status,
        lastLoginAt: lastLoginStr,
        memberIds: [m.id],
      });
    }
  }

  let items = Array.from(byUser.values());

  if (filters.lastActiveFrom) {
    const from = new Date(filters.lastActiveFrom);
    if (!Number.isNaN(from.getTime())) {
      items = items.filter((m) => {
        const t = m.lastLoginAt ? new Date(m.lastLoginAt) : null;
        return t && t >= from;
      });
    }
  }

  return { items, total: items.length };
}

/** Get one branch manager by userId (must be BRANCH_MANAGER in owner's org). */
export async function getBranchManagerDetailForOwner(
  ownerUserId: number,
  managerUserId: number
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) return null;

  const members = await prisma.branchMember.findMany({
    where: {
      userId: managerUserId,
      orgId: { in: orgIds },
      role: MemberRole.BRANCH_MANAGER,
    },
    include: {
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          status: true,
          auth: {
            select: {
              email: true,
              phone: true,
              lastLoginAt: true,
            },
          },
          profile: { select: { displayName: true, username: true } },
        },
      },
    },
  });

  if (members.length === 0) return null;

  const perms = await prisma.branchAccessPermission.findMany({
    where: {
      userId: managerUserId,
      branchId: { in: members.map((m) => m.branchId) },
    },
    include: { branch: { select: { id: true, name: true } } },
  });

  const auth = await prisma.userAuth.findUnique({
    where: { userId: managerUserId },
    select: { lastLoginAt: true },
  });

  return {
    user: members[0].user,
    memberships: members,
    branchAccess: perms,
    lastLoginAt: (members[0].user?.auth as any)?.lastLoginAt ?? auth?.lastLoginAt ?? null,
  };
}

/** Update manager status: BranchMember.status and optionally BranchAccessPermission (SUSPENDED). */
export async function updateBranchManagerStatus(
  ownerUserId: number,
  managerUserId: number,
  status: "ACTIVE" | "SUSPENDED"
) {
  const orgIds = await getOwnerOrgIds(ownerUserId);
  if (orgIds.length === 0) throw new Error("No organizations");

  const members = await prisma.branchMember.findMany({
    where: {
      userId: managerUserId,
      orgId: { in: orgIds },
      role: MemberRole.BRANCH_MANAGER,
    },
    select: { id: true, branchId: true },
  });
  if (members.length === 0) throw new Error("Branch manager not found");

  await prisma.$transaction([
    prisma.branchMember.updateMany({
      where: {
        userId: managerUserId,
        orgId: { in: orgIds },
        role: MemberRole.BRANCH_MANAGER,
      },
      data: { status },
    }),
    // Sync branch access permission status so suspension blocks login
    prisma.branchAccessPermission.updateMany({
      where: {
        userId: managerUserId,
        branchId: { in: members.map((m) => m.branchId) },
      },
      data: {
        status: status === "SUSPENDED" ? "SUSPENDED" : "APPROVED",
      },
    }),
  ]);

  return { ok: true, status };
}

/** Update permission overrides and/or login time window for a manager at a branch. */
export async function updateBranchManagerPermissions(
  ownerUserId: number,
  managerUserId: number,
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
    : (
        await prisma.branchMember.findMany({
          where: {
            userId: managerUserId,
            orgId: { in: orgIds },
            role: MemberRole.BRANCH_MANAGER,
          },
          select: { branchId: true },
        })
      ).map((m) => m.branchId);

  const data: any = {};
  if (payload.permissionOverrides !== undefined) data.permissionOverrides = payload.permissionOverrides;
  if (payload.loginWindowStart !== undefined) data.loginWindowStart = payload.loginWindowStart || null;
  if (payload.loginWindowEnd !== undefined) data.loginWindowEnd = payload.loginWindowEnd || null;

  if (Object.keys(data).length === 0) return { ok: true };

  const updated = await prisma.branchAccessPermission.updateMany({
    where: {
      userId: managerUserId,
      branchId: { in: branchIds },
    },
    data,
  });

  return { ok: true, updated: updated.count };
}

/** Revoke all sessions for a user (force logout). */
export async function forceLogoutUser(userId: number): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Get audit logs: (1) actions BY this manager (actorId = managerId), (2) actions ON this manager (entityType USER, entityId = managerId). */
export async function getBranchManagerAuditLogs(
  ownerUserId: number,
  managerUserId: number,
  limit = 100
) {
  await getBranchManagerDetailForOwner(ownerUserId, managerUserId);
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { actorId: String(managerUserId) },
        { entityType: "USER", entityId: String(managerUserId) },
      ],
    },
    take: Math.min(limit, 200),
    orderBy: { createdAt: "desc" },
  });
  return logs;
}

/** Performance snapshot for branches managed by this manager. */
export async function getBranchManagerPerformance(
  ownerUserId: number,
  managerUserId: number
) {
  const detail = await getBranchManagerDetailForOwner(ownerUserId, managerUserId);
  if (!detail) return null;

  const branchIds = detail.memberships.map((m) => m.branchId);
  if (branchIds.length === 0) return { branches: [], summary: {} };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [orderCounts, inventoryAlerts, branchList] = await Promise.all([
    prisma.order.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        createdAt: { gte: today },
      },
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.inventory.findMany({
      where: { branchId: { in: branchIds } },
      select: {
        branchId: true,
        productId: true,
        quantity: true,
        minStock: true,
      },
    }).then((rows) => rows.filter((r) => r.quantity <= r.minStock)),
    prisma.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true },
    }),
  ]);

  const orderByBranch = new Map(
    orderCounts.map((o) => [
      o.branchId,
      { count: o._count.id, total: (o._sum.totalAmount ?? 0) as number },
    ])
  );
  const alertsByBranch = new Map<number, number>();
  for (const inv of inventoryAlerts) {
    alertsByBranch.set(inv.branchId, (alertsByBranch.get(inv.branchId) ?? 0) + 1);
  }

  const branches = branchList.map((b) => ({
    branchId: b.id,
    name: b.name,
    ordersToday: orderByBranch.get(b.id)?.count ?? 0,
    salesToday: orderByBranch.get(b.id)?.total ?? 0,
    inventoryAlerts: alertsByBranch.get(b.id) ?? 0,
  }));

  return {
    branches,
    summary: {
      totalBranches: branches.length,
      totalOrdersToday: branches.reduce((s, b) => s + b.ordersToday, 0),
      totalSalesToday: branches.reduce((s, b) => s + b.salesToday, 0),
      totalInventoryAlerts: branches.reduce((s, b) => s + b.inventoryAlerts, 0),
    },
  };
}
