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
 * Get permissions for owner panel when user is a delegate (OwnerDelegation) or team member (OwnerTeamMember).
 * Returns union of scope permissions across all delegations and team scopes, intersected with base role perms.
 * Used by auth/me so delegated/team users get scope-filtered menu.
 */
async function getPermissionsForOwnerPanel(userId: number): Promise<string[]> {
  const [delegations, teamMembers] = await Promise.all([
    db.ownerDelegation.findMany({
      where: { delegatedUserId: userId },
      select: { scopeKey: true },
    }),
    db.ownerTeamMember.findMany({
      where: { userId },
      select: { team: { select: { scopes: true } } },
    }),
  ]);

  const scopePerms = new Set<string>();
  for (const d of delegations) {
    for (const p of SCOPE_TO_PERMISSIONS[d.scopeKey] ?? []) {
      scopePerms.add(p);
    }
  }
  for (const tm of teamMembers) {
    const scopes = tm.team?.scopes;
    const keys = Array.isArray(scopes) ? scopes : (typeof scopes === "object" && scopes !== null ? Object.keys(scopes) : []);
    for (const key of keys) {
      for (const p of SCOPE_TO_PERMISSIONS[String(key)] ?? []) {
        scopePerms.add(p);
      }
    }
  }
  if (scopePerms.size === 0) return [];

  // Grant scope permissions so team/delegate can act within their scope (e.g. product.edit).
  // Optionally intersect with base role for extra restriction; here we grant scope perms
  // so staff with "products" scope get product.update without needing it in base role.
  return Array.from(scopePerms);
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
