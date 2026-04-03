/**
 * Branch type → allowed invite roles (single source of truth).
 * Used by staff invite validation and by UI to show role dropdown.
 * Align with Prisma MemberRole enum.
 */

/** Prisma select fragment: Branch has no scalar `type`; use `types` → BranchType. */
export const prismaBranchSelectTypeCodes = {
  id: true,
  name: true,
  types: { select: { type: { select: { code: true, nameEn: true } } } },
} as const;

/** Normalize role string to uppercase enum style; accept common UI aliases. */
export function normalizeRole(role: string | null | undefined): string {
  if (role == null || role === "") return "";
  const r = String(role).trim().toUpperCase().replace(/\s+/g, "_");
  if (r === "STAFF") return "BRANCH_STAFF";
  return r;
}

/** Branch type codes (from BranchType.code / BranchTypeCode). */
export const BRANCH_TYPE_CODES = ["SHOP", "PET_SHOP", "CLINIC", "DELIVERY_HUB", "DELIVERY", "HUB"] as const;

/**
 * Allowed invite roles per branch type.
 * Keys: normalized branch type (primary type of branch).
 * Values: roles that are valid for that branch type (for display + validation).
 */
export const ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE: Record<string, string[]> = {
  SHOP: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
  PET_SHOP: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
  /** Align with unified staff orchestration (doctor onboarding via inviteAsDoctor). */
  CLINIC: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DOCTOR"],
  PHARMACY: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "PHARMACIST"],
  DELIVERY_HUB: ["DELIVERY_MANAGER", "DELIVERY_STAFF"],
  DELIVERY: ["DELIVERY_MANAGER", "DELIVERY_STAFF"],
  HUB: ["DELIVERY_MANAGER", "DELIVERY_STAFF"],
  WAREHOUSE: ["WAREHOUSE_MANAGER", "RECEIVING_STAFF", "DISPATCH_STAFF", "DELIVERY_STAFF"],
  CENTRAL_WAREHOUSE: ["WAREHOUSE_MANAGER", "RECEIVING_STAFF", "DISPATCH_STAFF", "DELIVERY_STAFF"],
};

/** Default when branch type is unknown: allow same as SHOP. */
const DEFAULT_ALLOWED_ROLES = ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"];

/** Roles that a Branch Manager / Delivery Manager cannot invite (manager/owner level). */
export const ROLES_MANAGER_CANNOT_INVITE: string[] = [
  "BRANCH_MANAGER",
  "DELIVERY_MANAGER",
  "WAREHOUSE_MANAGER",
  "OWNER",
  "ORG_ADMIN",
  "ORG_OWNER",
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
  "STATE_ADMIN",
];

/** Roles that a manager can invite (staff/seller only). */
export const ROLES_MANAGER_CAN_INVITE: string[] = [
  "BRANCH_STAFF",
  "SELLER",
  "DELIVERY_STAFF",
  "RECEIVING_STAFF",
  "DISPATCH_STAFF",
];

/** Resolve primary branch type code from branch.types[].type.code. */
export function getPrimaryBranchTypeCode(branch: {
  types?: Array<{ type?: { code?: string } }>;
}): string {
  const links = branch?.types || [];
  for (const x of links) {
    const code = String(x?.type?.code || "").toUpperCase().replace(/\s+/g, "_");
    if (code && (ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE as Record<string, unknown>)[code]) return code;
  }
  if (links.some((x) => String(x?.type?.code || "").toUpperCase() === "DELIVERY_HUB")) return "DELIVERY_HUB";
  if (links.some((x) => ["DELIVERY", "HUB"].includes(String(x?.type?.code || "").toUpperCase()))) return "DELIVERY_HUB";
  return "SHOP";
}

/** Allowed invite roles for this branch (by type). */
export function getAllowedInviteRolesForBranch(branch: {
  types?: Array<{ type?: { code?: string } }>;
}): string[] {
  const code = getPrimaryBranchTypeCode(branch);
  return ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE[code] ?? DEFAULT_ALLOWED_ROLES;
}

/**
 * Roles this inviter can invite for this branch.
 * - OWNER / ORG_OWNER / ORG_ADMIN: any role in allowedInviteRoles for branch type.
 * - BRANCH_MANAGER / DELIVERY_MANAGER: only ROLES_MANAGER_CAN_INVITE, and only if in allowedInviteRoles.
 */
export function getInviteableRolesForInviter(
  inviterRole: string | null | undefined,
  branch: { types?: Array<{ type?: { code?: string } }> }
): string[] {
  const inviter = normalizeRole(inviterRole);
  const allowedForBranch = getAllowedInviteRolesForBranch(branch);

  const isOwnerLevel =
    inviter === "OWNER" || inviter === "ORG_OWNER" || inviter === "ORG_ADMIN";

  if (isOwnerLevel) return allowedForBranch;

  const isManager =
    inviter === "BRANCH_MANAGER" || inviter === "DELIVERY_MANAGER" || inviter === "WAREHOUSE_MANAGER";

  if (isManager) {
    return ROLES_MANAGER_CAN_INVITE.filter((r) => allowedForBranch.includes(r));
  }

  return [];
}

/**
 * Check if this inviter can invite this target role to this branch.
 * Returns { allowed: boolean, message?: string }.
 */
export function canInviteRole(
  inviterRole: string | null | undefined,
  targetRole: string | null | undefined,
  branch: { types?: Array<{ type?: { code?: string } }> }
): { allowed: boolean; message?: string } {
  const inviter = normalizeRole(inviterRole);
  const target = normalizeRole(targetRole);

  if (!target) return { allowed: false, message: "role is required" };

  const allowedForBranch = getAllowedInviteRolesForBranch(branch);
  if (!allowedForBranch.includes(target)) {
    return { allowed: false, message: "Invalid role for this branch type" };
  }

  const isOwnerLevel =
    inviter === "OWNER" || inviter === "ORG_OWNER" || inviter === "ORG_ADMIN";
  if (isOwnerLevel) return { allowed: true };

  const isManager =
    inviter === "BRANCH_MANAGER" || inviter === "DELIVERY_MANAGER" || inviter === "WAREHOUSE_MANAGER";
  if (isManager) {
    if (ROLES_MANAGER_CANNOT_INVITE.includes(target)) {
      return {
        allowed: false,
        message: "Manager cannot invite another manager or owner-level role",
      };
    }
    if (!ROLES_MANAGER_CAN_INVITE.includes(target)) {
      return { allowed: false, message: "Invalid role for this branch type" };
    }
    return { allowed: true };
  }

  return { allowed: false, message: "Only owner or branch manager can invite staff" };
}
