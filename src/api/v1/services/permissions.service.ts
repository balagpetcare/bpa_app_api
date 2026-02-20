/**
 * Phase 4: Effective permissions (Scope + Action) for a user.
 * Aggregates from global roles + country roles (for countryCode) + org/branch roles.
 * Reference: docs/GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md
 */

import type { PrismaClient } from "@prisma/client";

export type PermissionEntry = { key: string; scope: string };
export type RoleEntry = { key: string; scope: string; countryId?: number; stateId?: number };

/**
 * Get effective permissions and role keys for a user.
 * @param prisma - PrismaClient
 * @param userId - User id
 * @param countryCode - Optional; if provided, include country roles for that country
 */
export async function getEffectivePermissions(
  prisma: PrismaClient,
  userId: number,
  countryCode?: string,
  stateId?: number | null
): Promise<{ permissions: PermissionEntry[]; roles: RoleEntry[] }> {
  const permissions: Map<string, PermissionEntry> = new Map();
  const roles: Map<string, RoleEntry> = new Map();

  // Global roles
  const globalAssignments = await prisma.userGlobalRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: { select: { key: true } } } },
        },
      },
    },
  });
  for (const a of globalAssignments) {
    roles.set(a.role.key, { key: a.role.key, scope: a.role.scope });
    for (const rp of a.role.rolePermissions || []) {
      const key = rp.permission?.key;
      if (key) permissions.set(key, { key, scope: a.role.scope });
    }
  }

  // Country roles (for the given country)
  if (countryCode) {
    const country = await prisma.country.findFirst({
      where: { code: String(countryCode).toUpperCase().trim(), isActive: true },
      select: { id: true },
    });
    if (country) {
      const countryAssignments = await prisma.userCountryRole.findMany({
        where: { userId, countryId: country.id },
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: { select: { key: true } } } },
            },
          },
        },
      });
      for (const a of countryAssignments) {
        roles.set(`${a.role.key}:${country.id}`, {
          key: a.role.key,
          scope: a.role.scope,
          countryId: country.id,
        });
        for (const rp of a.role.rolePermissions || []) {
          const key = rp.permission?.key;
          if (key) permissions.set(key, { key, scope: a.role.scope });
        }
      }
    }
  }

  // State roles (for the given state)
  if (stateId) {
    const stateAssignments = await prisma.userStateRole.findMany({
      where: { userId, stateId: Number(stateId) },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    for (const a of stateAssignments) {
      roles.set(`state:${a.role.key}:${stateId}`, {
        key: a.role.key,
        scope: a.role.scope,
        stateId: Number(stateId),
      });
      for (const rp of a.role.rolePermissions || []) {
        const key = rp.permission?.key;
        if (key) permissions.set(key, { key, scope: a.role.scope });
      }
    }
  }

  // Org member roles
  const orgMembers = await prisma.orgMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      roles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });
  for (const m of orgMembers) {
    for (const omr of m.roles || []) {
      const role = omr.role;
      if (role) {
        roles.set(`org:${role.key}:${m.orgId}`, { key: role.key, scope: role.scope });
        for (const rp of role.rolePermissions || []) {
          const key = rp.permission?.key;
          if (key) permissions.set(key, { key, scope: role.scope });
        }
      }
    }
  }

  // Branch member roles
  const branchMembers = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      roles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });
  for (const m of branchMembers) {
    for (const bmr of m.roles || []) {
      const role = bmr.role;
      if (role) {
        roles.set(`branch:${role.key}:${m.branchId}`, { key: role.key, scope: role.scope });
        for (const rp of role.rolePermissions || []) {
          const key = rp.permission?.key;
          if (key) permissions.set(key, { key, scope: role.scope });
        }
      }
    }
  }

  return {
    permissions: Array.from(permissions.values()),
    roles: Array.from(roles.values()),
  };
}
