import { PrismaClient, BranchAccessPermissionStatus, MemberRole } from "@prisma/client";

// Reuse the shared Prisma client (CJS default export)
// to stay consistent with existing services (branchAccessPermission.service.ts etc.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma: PrismaClient = require("../../../infrastructure/db/prismaClient").default;

export type ManagedBranchSummary = {
  branchId: number;
  orgId: number;
  name: string;
  types: { code: string; nameEn: string | null }[];
  features: Record<string, any>;
};

export type BranchManagerKpis = {
  branchId: number;
  orgId: number;
  date: string; // ISO date (YYYY-MM-DD)
  orders: {
    countToday: number;
    totalAmountToday: string; // decimal as string
  };
  staff: {
    totalActive: number;
    managers: number;
    staff: number;
  };
  accessRequests: {
    pending: number;
    approved: number;
  };
};

export type BranchStaffOverviewItem = {
  memberId: number;
  userId: number;
  role: MemberRole;
  status: string;
  createdAt: string;
  user: {
    id: number;
    displayName: string | null;
    username: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  branchAccess?: {
    status: BranchAccessPermissionStatus;
    expiresAt: string | null;
    lastLoginAt: string | null;
  } | null;
};

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/**
 * Identify all branches that a user manages.
 *
 * A user is considered a branch manager if:
 * - They have a BranchMember record with role = BRANCH_MANAGER and status = ACTIVE
 * - And they have an APPROVED (and non-expired) BranchAccessPermission for that branch
 *
 * Additionally, org owners implicitly manage all branches in their organizations.
 */
export async function getManagedBranchesForUser(userId: number): Promise<ManagedBranchSummary[]> {
  if (!userId) return [];

  // 1) Explicit branch manager memberships
  const branchMembers = await prisma.branchMember.findMany({
    where: {
      userId,
      role: MemberRole.BRANCH_MANAGER,
      status: "ACTIVE",
    },
    select: {
      branchId: true,
      orgId: true,
      branch: {
        select: {
          id: true,
          orgId: true,
          name: true,
          featuresJson: true,
          typeLinks: {
            select: {
              branchType: {
                select: {
                  code: true,
                  nameEn: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const branchIdsFromMembership = branchMembers.map((m) => m.branchId);

  // 2) Org owner branches (implicit managers)
  const ownedOrgs = await prisma.organization.findMany({
    where: {
      ownerUserId: userId,
    },
    select: { id: true },
  });

  const ownedOrgIds = ownedOrgs.map((o) => o.id);

  const ownerBranches =
    ownedOrgIds.length > 0
      ? await prisma.branch.findMany({
          where: { orgId: { in: ownedOrgIds } },
          select: {
            id: true,
            orgId: true,
            name: true,
            featuresJson: true,
            typeLinks: {
              select: {
                branchType: {
                  select: {
                    code: true,
                    nameEn: true,
                  },
                },
              },
            },
          },
        })
      : [];

  // 3) Apply branch access permission filter (APPROVED + not expired)
  const candidateBranchIds = Array.from(
    new Set([
      ...branchIdsFromMembership,
      ...ownerBranches.map((b) => b.id),
    ]),
  );

  if (candidateBranchIds.length === 0) return [];

  const permissions = await prisma.branchAccessPermission.findMany({
    where: {
      userId,
      branchId: { in: candidateBranchIds },
      status: BranchAccessPermissionStatus.APPROVED,
    },
    select: {
      branchId: true,
      expiresAt: true,
    },
  });

  const now = new Date();
  const activeBranchIds = new Set(
    permissions
      .filter((p) => !p.expiresAt || new Date(p.expiresAt) > now)
      .map((p) => p.branchId),
  );

  const managerBranches = branchMembers
    .filter((m) => activeBranchIds.has(m.branchId))
    .map((m) => m.branch);

  const implicitOwnerBranches = ownerBranches.filter((b) => activeBranchIds.has(b.id));

  const allBranches = [...managerBranches, ...implicitOwnerBranches];

  const uniqueById = new Map<number, (typeof allBranches)[number]>();
  for (const b of allBranches) {
    uniqueById.set(b.id, b);
  }

  return Array.from(uniqueById.values()).map((b) => ({
    branchId: b.id,
    orgId: b.orgId,
    name: b.name,
    types:
      b.typeLinks?.map((t) => ({
        code: t.branchType.code,
        nameEn: t.branchType.nameEn ?? null,
      })) ?? [],
    features: (b.featuresJson as any) || {},
  }));
}

/**
 * Utility: check if a user is a manager (or org owner) for a specific branch.
 * Also enforces BranchAccessPermission APPROVED + not expired (except owners, who have implicit access).
 */
export async function assertBranchManagerAccess(
  userId: number,
  branchId: number,
): Promise<{
  branch: { id: number; orgId: number; name: string };
  isOrgOwner: boolean;
}> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      orgId: true,
      name: true,
      org: { select: { ownerUserId: true } },
    },
  });

  if (!branch) {
    throw new Error("Branch not found");
  }

  const isOrgOwner = branch.org?.ownerUserId === userId;

  // Check explicit branch manager membership
  const member = await prisma.branchMember.findFirst({
    where: {
      branchId,
      userId,
      role: MemberRole.BRANCH_MANAGER,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (!member && !isOrgOwner) {
    throw new Error("Not authorized as branch manager for this branch");
  }

  // Owners have implicit access; staff managers must also have branch access permission
  if (!isOrgOwner) {
    const perm = await prisma.branchAccessPermission.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
      select: {
        status: true,
        expiresAt: true,
      },
    });

    if (!perm || perm.status !== BranchAccessPermissionStatus.APPROVED) {
      throw new Error("Branch access not approved for manager");
    }

    if (perm.expiresAt && new Date(perm.expiresAt) <= new Date()) {
      throw new Error("Branch access expired for manager");
    }
  }

  return {
    branch: { id: branch.id, orgId: branch.orgId, name: branch.name },
    isOrgOwner,
  };
}

/**
 * Aggregate daily KPIs for a branch manager dashboard.
 * This is intentionally minimal and focuses on MVP metrics:
 * - Orders today (count + totalAmount)
 * - Staff counts (active, managers, staff)
 * - Branch access permission counts (pending, approved)
 */
export async function getBranchManagerKpis(
  userId: number,
  branchId: number,
): Promise<BranchManagerKpis> {
  const { branch } = await assertBranchManagerAccess(userId, branchId);
  const today = startOfToday();

  // Orders today
  const [ordersAgg] = await prisma.$queryRawUnsafe<
    { count: bigint; total: string | null }[]
  >(
    `
      SELECT
        COUNT(*)::bigint AS count,
        COALESCE(SUM("totalAmount")::text, '0') AS total
      FROM "orders"
      WHERE "branchId" = $1
        AND "createdAt" >= $2
    `,
    branchId,
    today,
  );

  const ordersCount = ordersAgg?.count ? Number(ordersAgg.count) : 0;
  const ordersTotal = ordersAgg?.total ?? "0";

  // Staff counts for this branch
  const staffByRole = await prisma.branchMember.groupBy({
    by: ["role"],
    where: {
      branchId,
      status: "ACTIVE",
    },
    _count: {
      _all: true,
    },
  });

  let totalActive = 0;
  let managers = 0;
  let staff = 0;
  for (const row of staffByRole) {
    totalActive += row._count._all;
    if (row.role === MemberRole.BRANCH_MANAGER) {
      managers += row._count._all;
    } else {
      staff += row._count._all;
    }
  }

  // Branch access permission counts
  const accessCounts = await prisma.branchAccessPermission.groupBy({
    by: ["status"],
    where: {
      branchId,
    },
    _count: {
      _all: true,
    },
  });

  let pending = 0;
  let approved = 0;
  for (const row of accessCounts) {
    if (row.status === BranchAccessPermissionStatus.PENDING) {
      pending += row._count._all;
    }
    if (row.status === BranchAccessPermissionStatus.APPROVED) {
      approved += row._count._all;
    }
  }

  return {
    branchId: branch.id,
    orgId: branch.orgId,
    date: today.toISOString().slice(0, 10),
    orders: {
      countToday: ordersCount,
      totalAmountToday: ordersTotal,
    },
    staff: {
      totalActive,
      managers,
      staff,
    },
    accessRequests: {
      pending,
      approved,
    },
  };
}

/**
 * Staff overview for a branch manager.
 * Combines BranchMember + BranchAccessPermission (if exists) for each user.
 */
export async function getBranchStaffOverview(
  userId: number,
  branchId: number,
): Promise<BranchStaffOverviewItem[]> {
  await assertBranchManagerAccess(userId, branchId);

  const members = await prisma.branchMember.findMany({
    where: {
      branchId,
    },
    include: {
      user: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              username: true,
            },
          },
          auth: {
            select: {
              email: true,
              phone: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const userIds = members.map((m) => m.userId);

  const perms =
    userIds.length > 0
      ? await prisma.branchAccessPermission.findMany({
          where: {
            branchId,
            userId: { in: userIds },
          },
          select: {
            userId: true,
            status: true,
            expiresAt: true,
            lastLoginAt: true,
          },
        })
      : [];

  const permByUserId = new Map<number, (typeof perms)[number]>();
  for (const p of perms) {
    permByUserId.set(p.userId, p);
  }

  return members.map<BranchStaffOverviewItem>((m) => {
    const perm = permByUserId.get(m.userId);
    return {
      memberId: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      user: m.user
        ? {
            id: m.user.id,
            displayName: m.user.profile?.displayName ?? null,
            username: m.user.profile?.username ?? null,
            email: m.user.auth?.email ?? null,
            phone: m.user.auth?.phone ?? null,
          }
        : null,
      branchAccess: perm
        ? {
            status: perm.status,
            expiresAt: perm.expiresAt ? perm.expiresAt.toISOString() : null,
            lastLoginAt: perm.lastLoginAt ? perm.lastLoginAt.toISOString() : null,
          }
        : null,
    };
  });
}

