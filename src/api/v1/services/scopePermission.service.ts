/**
 * Scope-Based Permission Engine
 * Additional filter ON TOP of existing role-based access control.
 * - If user has no delegation scope, fall back to existing role behavior
 * - If user has delegation scope, filter permissions by scope
 * - Owner retains full control
 */
export {};

const db = require("../../../infrastructure/db/prismaClient").default;
const { resolvePermissionsForUser } = require("../utils/permissions");
const { SCOPE_TO_PERMISSIONS } = require("../constants/delegationScopes");
const { hasDelegationScope } = require("./ownerDelegation.service");

/**
 * Get effective permissions for a user, optionally filtered by delegation scope.
 * - If userId is the owner, returns full OWNER permissions (no filter)
 * - If userId is delegated with scope for this owner, returns role perms INTERSECT scope perms
 * - Otherwise returns role perms as-is (existing behavior)
 */
async function resolvePermissionsWithScope(
  userId: number,
  context?: {
    ownerUserId?: number;
    orgId?: number;
    branchId?: number;
  }
): Promise<string[]> {
  const basePerms = await resolvePermissionsForUser(userId);

  // Owner or no delegation context: return full role perms
  if (!context?.ownerUserId || userId === context.ownerUserId) {
    return basePerms;
  }

  const delegations = await db.ownerDelegation.findMany({
    where: {
      ownerUserId: context.ownerUserId,
      delegatedUserId: userId,
    },
  });

  if (delegations.length === 0) {
    // No delegation: existing behavior (may have access via branch/org membership)
    return basePerms;
  }

  // User is delegated: filter base perms to only those granted by their scopes
  const scopePerms = new Set<string>();
  for (const d of delegations) {
    const matches =
      (d.orgId == null && d.branchId == null) ||
      (context.orgId != null && d.orgId === context.orgId && d.branchId == null) ||
      (context.branchId != null && d.branchId === context.branchId);
    if (matches) {
      for (const p of SCOPE_TO_PERMISSIONS[d.scopeKey] ?? []) {
        scopePerms.add(p);
      }
    }
  }

  if (scopePerms.size === 0) return [];

  return basePerms.filter((p) => scopePerms.has(p));
}

/**
 * Check if user has required permission in delegation context.
 */
async function hasPermissionWithScope(
  userId: number,
  permissionKey: string,
  context?: { ownerUserId?: number; orgId?: number; branchId?: number }
): Promise<boolean> {
  const perms = await resolvePermissionsWithScope(userId, context);
  return perms.includes(permissionKey);
}

/**
 * Get permissions for owner panel when user is a delegate (has OwnerDelegation records).
 * Returns union of scope permissions across all delegations, intersected with base role perms.
 * Used by auth/me so delegated users get scope-filtered menu.
 */
async function getPermissionsForOwnerPanel(userId: number): Promise<string[]> {
  const delegations = await db.ownerDelegation.findMany({
    where: { delegatedUserId: userId },
    select: { scopeKey: true },
  });
  if (delegations.length === 0) return [];

  const scopePerms = new Set<string>();
  for (const d of delegations) {
    for (const p of SCOPE_TO_PERMISSIONS[d.scopeKey] ?? []) {
      scopePerms.add(p);
    }
  }
  const basePerms = await resolvePermissionsForUser(userId);
  return basePerms.filter((p) => scopePerms.has(p));
}

/**
 * Check if user has a specific delegation scope for owner/org/branch.
 */
module.exports = {
  resolvePermissionsWithScope,
  hasPermissionWithScope,
  hasDelegationScope,
  getPermissionsForOwnerPanel,
};
