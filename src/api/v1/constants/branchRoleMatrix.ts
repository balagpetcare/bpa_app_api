/**
 * Branch type → allowed invite roles (single source of truth).
 * Used by staff invite validation and by UI (via invite-allowed-roles API).
 * Align with Prisma MemberRole enum.
 *
 * Multi-type branches: allowed roles = union of roles for each linked BranchType.code
 * (after normalizing aliases → canonical keys below).
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

function normalizeTypeCode(code: string | null | undefined): string {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

/**
 * Map DB / legacy BranchType.code → key in ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE.
 * Seeded codes: CLINIC, PET_SHOP, DELIVERY_HUB, WAREHOUSE_DC, … plus optional aliases.
 */
export const BRANCH_TYPE_CODE_ALIASES: Record<string, string> = {
  PHARMACY: "PHARMACY_DIAGNOSTICS",
  WAREHOUSE: "WAREHOUSE_DC",
  CENTRAL_WAREHOUSE: "WAREHOUSE_DC",
  DISTRIBUTION_CENTER: "WAREHOUSE_DC",
  DELIVERY: "DELIVERY_HUB",
  HUB: "DELIVERY_HUB",
};

/** Canonical matrix keys (each must have an entry in ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE). */
export const BRANCH_TYPE_CODES = [
  "SHOP",
  "PET_SHOP",
  "CLINIC",
  "PHARMACY_DIAGNOSTICS",
  "DELIVERY_HUB",
  "WAREHOUSE_DC",
  "GROOMING_SPA",
  "BOARDING_DAYCARE",
  "FOSTER_SHELTER",
  "TRAINING_BEHAVIOR",
] as const;

/**
 * Allowed invite roles per canonical branch type.
 * Warehouse operational roles INVENTORY_CONTROLLER / QC_OFFICER / AUDIT_OFFICER stay on WarehouseStaffRole + warehouse invite only.
 */
export const ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE: Record<string, string[]> = {
  SHOP: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
  PET_SHOP: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
  CLINIC: [
    "BRANCH_MANAGER",
    "CLINIC_STAFF",
    "CLINIC_RECEPTION",
    "CLINIC_INVENTORY_STAFF",
    "BRANCH_STAFF",
    "SELLER",
    "DOCTOR",
  ],
  PHARMACY_DIAGNOSTICS: [
    "BRANCH_MANAGER",
    "BRANCH_STAFF",
    "PHARMACIST",
    "CLINIC_INVENTORY_STAFF",
    "SELLER",
  ],
  DELIVERY_HUB: ["DELIVERY_MANAGER", "DELIVERY_STAFF"],
  WAREHOUSE_DC: ["WAREHOUSE_MANAGER", "RECEIVING_STAFF", "DISPATCH_STAFF", "DELIVERY_STAFF"],
  GROOMING_SPA: ["BRANCH_MANAGER", "GROOMING_STAFF", "BRANCH_STAFF"],
  BOARDING_DAYCARE: ["BRANCH_MANAGER", "BOARDING_STAFF", "BRANCH_STAFF"],
  FOSTER_SHELTER: ["BRANCH_MANAGER", "BOARDING_STAFF", "BRANCH_STAFF"],
  TRAINING_BEHAVIOR: ["BRANCH_MANAGER", "TRAINING_STAFF", "BRANCH_STAFF"],
};

/** Default when no known type on branch. */
const DEFAULT_ALLOWED_ROLES = ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"];

/** Stable dropdown order for any union of roles (UX). */
const INVITE_ROLE_DISPLAY_ORDER: string[] = [
  "BRANCH_MANAGER",
  "DELIVERY_MANAGER",
  "WAREHOUSE_MANAGER",
  "DOCTOR",
  "PHARMACIST",
  "CLINIC_STAFF",
  "CLINIC_RECEPTION",
  "CLINIC_INVENTORY_STAFF",
  "GROOMING_STAFF",
  "BOARDING_STAFF",
  "TRAINING_STAFF",
  "BRANCH_STAFF",
  "SELLER",
  "DELIVERY_STAFF",
  "RECEIVING_STAFF",
  "DISPATCH_STAFF",
];

/** Human-readable labels for invite dropdowns and APIs (single backend source for owner panel). */
export const INVITE_ROLE_LABELS: Record<string, string> = {
  BRANCH_MANAGER: "Branch Manager",
  BRANCH_STAFF: "Branch Staff",
  SELLER: "Seller",
  DOCTOR: "Doctor",
  DELIVERY_MANAGER: "Delivery Manager",
  DELIVERY_STAFF: "Delivery Staff",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  RECEIVING_STAFF: "Receiving Staff",
  DISPATCH_STAFF: "Dispatch Staff",
  PHARMACIST: "Pharmacist",
  CLINIC_STAFF: "Clinic Staff",
  CLINIC_RECEPTION: "Clinic Reception",
  CLINIC_INVENTORY_STAFF: "Clinic Inventory Staff",
  GROOMING_STAFF: "Grooming Staff",
  BOARDING_STAFF: "Boarding / Daycare Staff",
  TRAINING_STAFF: "Training Staff",
};

/** Map allowed role keys → display label (falls back to key). */
export function labelsForInviteRoles(allowedRoles: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of allowedRoles) {
    out[r] = INVITE_ROLE_LABELS[r] || r;
  }
  return out;
}

/** Roles that a Branch Manager / Delivery Manager / Warehouse Manager cannot invite. */
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

/** Roles a manager may invite if also allowed for the branch type(s). */
export const ROLES_MANAGER_CAN_INVITE: string[] = [
  "BRANCH_STAFF",
  "SELLER",
  "DELIVERY_STAFF",
  "RECEIVING_STAFF",
  "DISPATCH_STAFF",
  "CLINIC_STAFF",
  "CLINIC_RECEPTION",
  "CLINIC_INVENTORY_STAFF",
  "PHARMACIST",
  "DOCTOR",
  "GROOMING_STAFF",
  "BOARDING_STAFF",
  "TRAINING_STAFF",
];

function canonicalBranchTypeKey(rawCode: string): string {
  const u = normalizeTypeCode(rawCode);
  if (!u) return "";
  return BRANCH_TYPE_CODE_ALIASES[u] || u;
}

function rolesForRawTypeCode(rawCode: string): string[] | null {
  const u = normalizeTypeCode(rawCode);
  if (!u) return null;
  const key = BRANCH_TYPE_CODE_ALIASES[u] || u;
  return ALLOWED_INVITE_ROLES_BY_BRANCH_TYPE[key] ?? null;
}

/**
 * Union of allowed invite roles for all branch types linked to the branch.
 */
export function getAllowedInviteRolesForBranch(branch: {
  types?: Array<{ type?: { code?: string } }>;
}): string[] {
  const links = branch?.types || [];
  if (links.length === 0) return DEFAULT_ALLOWED_ROLES;

  const set = new Set<string>();
  for (const x of links) {
    const raw = String(x?.type?.code || "");
    const list = rolesForRawTypeCode(raw);
    if (list) list.forEach((r) => set.add(r));
  }

  if (set.size === 0) return DEFAULT_ALLOWED_ROLES;

  const ordered: string[] = [];
  for (const r of INVITE_ROLE_DISPLAY_ORDER) {
    if (set.has(r)) ordered.push(r);
  }
  for (const r of set) {
    if (!ordered.includes(r)) ordered.push(r);
  }
  return ordered;
}

/**
 * Primary type label for logging/UI (first match by priority when multiple types).
 */
export function getPrimaryBranchTypeCode(branch: {
  types?: Array<{ type?: { code?: string } }>;
}): string {
  const links = branch?.types || [];
  const present = new Set<string>();
  for (const x of links) {
    const key = canonicalBranchTypeKey(String(x?.type?.code || ""));
    if (key) present.add(key);
    const raw = normalizeTypeCode(x?.type?.code);
    if (raw) present.add(raw);
  }

  const priority = [
    "WAREHOUSE_DC",
    "PHARMACY_DIAGNOSTICS",
    "CLINIC",
    "DELIVERY_HUB",
    "GROOMING_SPA",
    "BOARDING_DAYCARE",
    "FOSTER_SHELTER",
    "TRAINING_BEHAVIOR",
    "PET_SHOP",
    "SHOP",
  ];

  for (const p of priority) {
    if (present.has(p)) return p;
  }

  if (links.some((x) => normalizeTypeCode(x?.type?.code) === "DELIVERY_HUB")) return "DELIVERY_HUB";
  if (links.some((x) => ["DELIVERY", "HUB"].includes(normalizeTypeCode(x?.type?.code)))) return "DELIVERY_HUB";

  return "SHOP";
}

/**
 * Roles this inviter can invite for this branch.
 * - OWNER / ORG_OWNER / ORG_ADMIN: any role in allowed set for branch type(s).
 * - BRANCH_MANAGER / DELIVERY_MANAGER / WAREHOUSE_MANAGER: ROLES_MANAGER_CAN_INVITE ∩ allowed.
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
