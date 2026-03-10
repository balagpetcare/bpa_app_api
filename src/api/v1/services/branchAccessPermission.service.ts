/**
 * Branch Access Permission Service
 * Handles all business logic for multi-branch staff permission management
 */

import { PrismaClient } from "@prisma/client";
import {
  BRANCH_ROLE_PERMISSIONS,
  BRANCH_DEFAULT_ROLE,
  BRANCH_DEFAULT_PERMISSIONS,
} from "../constants/branchRoles";

const prisma = require("../../../infrastructure/db/prismaClient").default;

export type BranchAccessProfile = {
  status: string;
  role: string;
  permissions: string[];
  scopes: string[];
  branchMeta: { branchId: number };
};

/**
 * Request branch access for a staff member
 */
export async function requestBranchAccess(userId: number, branchId: number, role?: string) {
  try {
    // Check if Prisma Client has the model (safety check using 'in' operator)
    if (!prisma || !('branchAccessPermission' in prisma)) {
      console.error("[BRANCH_ACCESS] Prisma Client not regenerated! Run: npx prisma generate");
      throw new Error("Branch access permission system not initialized. Please run: npx prisma generate");
    }

    // Verify user is a member of this branch
    const branchMember = await prisma.branchMember.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
    });

    if (!branchMember) {
      throw new Error("User is not a member of this branch");
    }

    const resolvedRole = role || branchMember.role || null;

  // Check if permission already exists
  const existing = await prisma.branchAccessPermission.findUnique({
    where: {
      branchId_userId: {
        branchId,
        userId,
      },
    },
  });

    if (existing) {
      if (existing.status === "PENDING") {
        return await prisma.branchAccessPermission.update({
          where: { id: existing.id },
          data: {
            role: resolvedRole ?? existing.role,
            requestedAt: new Date(),
            requestedByUserId: userId,
            note: null,
          },
        });
      }
      if (existing.status === "APPROVED") {
        // Check if expired
        if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
          // Update to expired
          return await prisma.branchAccessPermission.update({
            where: { id: existing.id },
            data: {
              status: "EXPIRED",
              updatedAt: new Date(),
            },
          });
        }
        return existing; // Already approved and active
      }
      // If REVOKED/EXPIRED/SUSPENDED, reset to pending
      return await prisma.branchAccessPermission.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          requestedAt: new Date(),
          requestedByUserId: userId,
          approvedByUserId: null,
          approvedAt: null,
          revokedByUserId: null,
          revokedAt: null,
          expiresAt: null,
          note: null,
          role: resolvedRole ?? existing.role,
          updatedAt: new Date(),
        },
      });
    }

    // Create new permission request
    return await prisma.branchAccessPermission.create({
      data: {
        branchId,
        userId,
        status: "PENDING",
        requestedAt: new Date(),
        requestedByUserId: userId,
        role: resolvedRole,
      },
    });
  } catch (error: any) {
    // Handle Prisma Client not regenerated error
    if (error?.message?.includes('branchAccessPermission') || !prisma || !('branchAccessPermission' in prisma)) {
      console.error("[BRANCH_ACCESS] Prisma Client error - model not found. Run: npx prisma generate");
      throw new Error("Branch access permission system not initialized. Please run: npx prisma generate");
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Approve branch access for a staff member
 */
export async function approveBranchAccess(
  permissionId: number,
  managerId: number,
  expiresAt?: Date
) {
  // Verify manager has permission to approve for this branch
  const permission = await prisma.branchAccessPermission.findUnique({
    where: { id: permissionId },
    include: {
      branch: {
        include: {
          members: {
            where: {
              userId: managerId,
              role: "BRANCH_MANAGER",
              status: "ACTIVE",
            },
          },
        },
      },
    },
  });

  if (!permission) {
    throw new Error("Permission request not found");
  }

  // Check if manager is a branch manager for this branch
  const isManager = permission.branch.members.length > 0;
  if (!isManager) {
    // Also check if user is org owner
    const org = await prisma.organization.findUnique({
      where: { id: permission.branch.orgId },
      select: { ownerUserId: true },
    });

    if (org?.ownerUserId !== managerId) {
      throw new Error("Only branch managers or org owners can approve access");
    }
  }

  // Validate expiresAt is in the future if provided
  if (expiresAt && new Date(expiresAt) <= new Date()) {
    throw new Error("Expiration date must be in the future");
  }

  return await prisma.branchAccessPermission.update({
    where: { id: permissionId },
    data: {
      status: "APPROVED",
      approvedByUserId: managerId,
      approvedAt: new Date(),
      expiresAt: expiresAt || null,
      revokedByUserId: null,
      revokedAt: null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Revoke branch access for a staff member
 */
export async function revokeBranchAccess(permissionId: number, managerId: number, note?: string) {
  // Verify manager has permission to revoke for this branch
  const permission = await prisma.branchAccessPermission.findUnique({
    where: { id: permissionId },
    include: {
      branch: {
        include: {
          members: {
            where: {
              userId: managerId,
              role: "BRANCH_MANAGER",
              status: "ACTIVE",
            },
          },
        },
      },
    },
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  // Check if manager is a branch manager for this branch
  const isManager = permission.branch.members.length > 0;
  if (!isManager) {
    // Also check if user is org owner
    const org = await prisma.organization.findUnique({
      where: { id: permission.branch.orgId },
      select: { ownerUserId: true },
    });

    if (org?.ownerUserId !== managerId) {
      throw new Error("Only branch managers or org owners can revoke access");
    }
  }

  return await prisma.branchAccessPermission.update({
    where: { id: permissionId },
    data: {
      status: "REVOKED",
      revokedByUserId: managerId,
      revokedAt: new Date(),
      note: note ?? null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Check if staff has active access to a branch
 */
export async function checkBranchAccess(userId: number, branchId: number): Promise<boolean> {
  try {
    // Check if Prisma Client has the model (safety check using 'in' operator)
    if (!prisma || !('branchAccessPermission' in prisma)) {
      console.error("[BRANCH_ACCESS] Prisma Client not regenerated! Run: npx prisma generate");
      console.error("[BRANCH_ACCESS] Returning false - access check unavailable");
      // For now, return false - user needs to regenerate Prisma Client
      return false;
    }

    const permission = await prisma.branchAccessPermission.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
    });

    if (!permission) {
      return false;
    }

    if (permission.status !== "APPROVED") {
      return false;
    }

    // Check if expired
    if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
      // Auto-expire
      await prisma.branchAccessPermission.update({
        where: { id: permission.id },
        data: {
          status: "EXPIRED",
          updatedAt: new Date(),
        },
      });
      return false;
    }

    return true;
  } catch (error: any) {
    // Handle Prisma Client not regenerated error
    const errorMsg = String(error?.message || '');
    if (
      errorMsg.includes('branchAccessPermission') ||
      errorMsg.includes('Cannot read properties of undefined') ||
      error?.code === 'P2001' ||
      !prisma ||
      !('branchAccessPermission' in prisma)
    ) {
      console.error("[BRANCH_ACCESS] Prisma Client error - model not found. Run: npx prisma generate");
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Resolve branch access profile for a user in a branch: status, role, permissions, scopes.
 * Uses APPROVED BranchAccessPermission + BranchMember.role; no fallback to default role when approved record exists.
 * Returns null when no APPROVED (or active) permission exists.
 */
export async function resolveBranchAccessProfile(
  userId: number,
  branchId: number
): Promise<BranchAccessProfile | null> {
  if (!prisma || !("branchAccessPermission" in prisma)) {
    return null;
  }

  const permission = await prisma.branchAccessPermission.findUnique({
    where: {
      branchId_userId: { branchId, userId },
    },
    select: {
      status: true,
      expiresAt: true,
      id: true,
      permissionOverrides: true,
    },
  });

  if (!permission || permission.status !== "APPROVED") {
    return null;
  }

  if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    await prisma.branchAccessPermission.update({
      where: { id: permission.id },
      data: { status: "EXPIRED", updatedAt: new Date() },
    });
    return null;
  }

  const member = await prisma.branchMember.findUnique({
    where: {
      branchId_userId: { branchId, userId },
    },
    select: {
      role: true,
      roles: {
        select: {
          role: { select: { key: true } },
        },
      },
    },
  });

  // Prefer Role from join table (e.g. CLINIC_STAFF) when present; MemberRole enum does not include CLINIC_STAFF.
  const roleKey =
    member?.roles?.[0]?.role?.key ||
    (member?.role as string) ||
    BRANCH_DEFAULT_ROLE;
  const basePermissions =
    BRANCH_ROLE_PERMISSIONS[roleKey] ||
    BRANCH_DEFAULT_PERMISSIONS;
  const overridesRaw = permission.permissionOverrides;
  const overrides = Array.isArray(overridesRaw)
    ? overridesRaw.filter((k): k is string => typeof k === "string")
    : overridesRaw && typeof overridesRaw === "object" && !Array.isArray(overridesRaw)
    ? Object.keys(overridesRaw)
    : [];
  const permissions = [...new Set([...basePermissions, ...overrides])];
  const scopes = ["branch"];

  return {
    status: permission.status,
    role: roleKey,
    permissions,
    scopes,
    branchMeta: { branchId },
  };
}

/**
 * Resolve branch access profile for a permission row (e.g. for my-requests enrichment).
 * Returns role + permissions even when status is PENDING (for display); permissions may be minimal.
 * If permission.permissionOverrides is provided (array of strings), merged additively into permissions.
 */
export async function resolveBranchAccessProfileFromPermission(
  permission: { branchId: number; userId: number; status: string; permissionOverrides?: unknown }
): Promise<{ role: string; permissions: string[]; scopes: string[] }> {
  const member = await prisma.branchMember.findUnique({
    where: {
      branchId_userId: {
        branchId: permission.branchId,
        userId: permission.userId,
      },
    },
    select: {
      role: true,
      roles: {
        select: {
          role: { select: { key: true } },
        },
      },
    },
  });

  // Prefer Role from join table (e.g. CLINIC_STAFF) when present.
  const roleKey =
    member?.roles?.[0]?.role?.key ||
    (member?.role as string) ||
    BRANCH_DEFAULT_ROLE;
  const basePermissions =
    BRANCH_ROLE_PERMISSIONS[roleKey] ||
    BRANCH_DEFAULT_PERMISSIONS;
  const overridesRaw = permission.permissionOverrides;
  const overrides = Array.isArray(overridesRaw)
    ? overridesRaw.filter((k): k is string => typeof k === "string")
    : overridesRaw && typeof overridesRaw === "object" && !Array.isArray(overridesRaw)
    ? Object.keys(overridesRaw)
    : [];
  const permissions = [...new Set([...basePermissions, ...overrides])];

  return {
    role: roleKey,
    permissions,
    scopes: ["branch"],
  };
}

/**
 * Get pending requests for a branch
 */
export async function getPendingRequestsForBranch(branchId: number) {
  return await prisma.branchAccessPermission.findMany({
    where: {
      branchId,
      status: "PENDING",
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
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      requestedAt: "desc",
    },
  });
}

/**
 * Get all pending requests for branches managed by a manager
 */
export async function getPendingRequestsForManager(managerId: number) {
  // Get all branches where user is a manager
  const branchMembers = await prisma.branchMember.findMany({
    where: {
      userId: managerId,
      role: "BRANCH_MANAGER",
      status: "ACTIVE",
    },
    select: {
      branchId: true,
    },
  });

  const branchIds = branchMembers.map((bm) => bm.branchId);

  // Also get branches from orgs where user is owner
  const ownedOrgs = await prisma.organization.findMany({
    where: {
      ownerUserId: managerId,
    },
    select: {
      id: true,
    },
  });

  const orgIds = ownedOrgs.map((o) => o.id);

  const ownedBranches = await prisma.branch.findMany({
    where: {
      orgId: { in: orgIds },
    },
    select: {
      id: true,
    },
  });

  const allBranchIds = [...branchIds, ...ownedBranches.map((b) => b.id)];

  if (allBranchIds.length === 0) {
    return [];
  }

  const results = await prisma.branchAccessPermission.findMany({
    where: {
      branchId: { in: allBranchIds },
      status: "PENDING",
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
      branch: {
        select: {
          id: true,
          name: true,
          org: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      requestedAt: "desc",
    },
  });

  return results;
}

/**
 * Get active permissions for a user
 */
export async function getActivePermissionsForUser(userId: number) {
  const permissions = await prisma.branchAccessPermission.findMany({
    where: {
      userId,
      status: "APPROVED",
    },
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          org: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  // Filter out expired permissions and update them
  const now = new Date();
  const activePermissions = [];
  const expiredIds = [];

  for (const perm of permissions) {
    if (perm.expiresAt && new Date(perm.expiresAt) < now) {
      expiredIds.push(perm.id);
    } else {
      activePermissions.push(perm);
    }
  }

  // Update expired permissions
  if (expiredIds.length > 0) {
    await prisma.branchAccessPermission.updateMany({
      where: {
        id: { in: expiredIds },
      },
      data: {
        status: "EXPIRED",
        updatedAt: new Date(),
      },
    });
  }

  return activePermissions;
}

/**
 * Get all permissions for a user (all statuses)
 */
export async function getAllPermissionsForUser(userId: number) {
  return await prisma.branchAccessPermission.findMany({
    where: {
      userId,
    },
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          org: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      approvedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      revokedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: {
      requestedAt: "desc",
    },
  });
}

/**
 * Update last login timestamp when staff accesses branch
 */
export async function updateLastLoginAt(userId: number, branchId: number) {
  const permission = await prisma.branchAccessPermission.findUnique({
    where: {
      branchId_userId: {
        branchId,
        userId,
      },
    },
  });

  if (permission && permission.status === "APPROVED") {
    await prisma.branchAccessPermission.update({
      where: { id: permission.id },
      data: {
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * Expire permissions that have passed their expiration date
 * This should be run as a background job
 */
export async function expirePermissions() {
  const now = new Date();
  const expired = await prisma.branchAccessPermission.findMany({
    where: {
      status: "APPROVED",
      expiresAt: {
        lte: now,
      },
    },
  });

  if (expired.length === 0) {
    return { expired: 0 };
  }

  await prisma.branchAccessPermission.updateMany({
    where: {
      id: { in: expired.map((p) => p.id) },
    },
    data: {
      status: "EXPIRED",
      updatedAt: new Date(),
    },
  });

  return {
    expired: expired.length,
    permissionIds: expired.map((p) => p.id),
  };
}

/**
 * Get all permissions for a branch
 */
export async function getPermissionsForBranch(branchId: number) {
  return await prisma.branchAccessPermission.findMany({
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
      approvedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      revokedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: {
      requestedAt: "desc",
    },
  });
}

/**
 * Get branch access list for owner (only branches under orgs owned by ownerUserId).
 * Optional status filter: PENDING | APPROVED | REVOKED | EXPIRED.
 */
export async function getBranchAccessListForOwner(
  ownerUserId: number,
  status?: "PENDING" | "APPROVED" | "REVOKED" | "EXPIRED"
) {
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId },
    select: { id: true },
  });
  const orgIds = ownedOrgs.map((o) => o.id);
  if (orgIds.length === 0) return [];

  const branchIds = await prisma.branch.findMany({
    where: { orgId: { in: orgIds } },
    select: { id: true },
  }).then((rows) => rows.map((r) => r.id));
  if (branchIds.length === 0) return [];

  const where: { branchId: { in: number[] }; status?: string } = {
    branchId: { in: branchIds },
  };
  if (status) where.status = status;

  const rows = await prisma.branchAccessPermission.findMany({
    where,
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
      branch: {
        select: {
          id: true,
          name: true,
          org: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { requestedAt: "desc" },
  });

  // Attach role from BranchMember for each row
  const withRole = await Promise.all(
    rows.map(async (row) => {
      const member = await prisma.branchMember.findUnique({
        where: {
          branchId_userId: { branchId: row.branchId, userId: row.userId },
        },
        select: { role: true },
      });
      return { ...row, role: member?.role ?? "STAFF" };
    })
  );
  return withRole;
}

async function ensureOwnerOwnsBranch(ownerUserId: number, branchId: number) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, org: { ownerUserId: ownerUserId } },
    select: { id: true, orgId: true },
  });
  if (!branch) {
    throw new Error("Forbidden: branch not under owner");
  }
  return branch;
}

async function ensurePermissionForOwner(permissionId: number, ownerUserId: number) {
  const permission = await prisma.branchAccessPermission.findFirst({
    where: {
      id: permissionId,
      branch: { org: { ownerUserId } },
    },
  });
  if (!permission) {
    throw new Error("Permission not found");
  }
  return permission;
}

export async function assignBranchAccessDirect(
  ownerUserId: number,
  staffUserId: number,
  branchId: number,
  role: string,
  note?: string,
  expiresAt?: Date
) {
  await ensureOwnerOwnsBranch(ownerUserId, branchId);
  const existing = await prisma.branchAccessPermission.findUnique({
    where: { branchId_userId: { branchId, userId: staffUserId } },
  });
  const data = {
    branchId,
    userId: staffUserId,
    status: "APPROVED" as const,
    role,
    requestedByUserId: ownerUserId,
    requestedAt: new Date(),
    approvedByUserId: ownerUserId,
    approvedAt: new Date(),
    revokedByUserId: null,
    revokedAt: null,
    expiresAt: expiresAt || null,
    note: note ?? null,
  };

  if (existing) {
    return prisma.branchAccessPermission.update({
      where: { id: existing.id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  return prisma.branchAccessPermission.create({
    data,
  });
}

export async function suspendBranchAccess(
  permissionId: number,
  ownerUserId: number,
  note?: string
) {
  await ensurePermissionForOwner(permissionId, ownerUserId);
  return prisma.branchAccessPermission.update({
    where: { id: permissionId },
    data: {
      status: "SUSPENDED",
      revokedByUserId: ownerUserId,
      revokedAt: new Date(),
      note: note ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function removeBranchAccess(
  permissionId: number,
  ownerUserId: number,
  note?: string
) {
  await ensurePermissionForOwner(permissionId, ownerUserId);
  return prisma.branchAccessPermission.update({
    where: { id: permissionId },
    data: {
      status: "REVOKED",
      revokedByUserId: ownerUserId,
      revokedAt: new Date(),
      note: note ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function updateBranchAccessRole(
  permissionId: number,
  ownerUserId: number,
  role: string
) {
  await ensurePermissionForOwner(permissionId, ownerUserId);
  return prisma.branchAccessPermission.update({
    where: { id: permissionId },
    data: {
      role,
      updatedAt: new Date(),
    },
  });
}

export async function getOwnerStaffAccessRows(ownerUserId: number) {
  return prisma.branchAccessPermission.findMany({
    where: {
      branch: { org: { ownerUserId } },
    },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
      branch: { select: { id: true, name: true } },
    },
    orderBy: [
      { userId: "asc" },
      { branchId: "asc" },
    ],
  });
}

export async function getOwnerStaffAccessRowsByUser(ownerUserId: number, staffUserId: number) {
  return prisma.branchAccessPermission.findMany({
    where: {
      userId: staffUserId,
      branch: { org: { ownerUserId } },
    },
    include: {
      branch: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
    },
    orderBy: { branchId: "asc" },
  });
}

export async function getOwnerBranchAccessRequest(ownerUserId: number, permissionId: number) {
  return prisma.branchAccessPermission.findFirst({
    where: {
      id: permissionId,
      branch: { org: { ownerUserId } },
    },
    include: {
      branch: { select: { id: true, name: true } },
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true, phone: true } },
        },
      },
    },
  });
}
