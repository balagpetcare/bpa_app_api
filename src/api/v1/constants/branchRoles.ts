/**
 * Branch Dashboard role → permission matrix.
 * Aligned with docs/dashboard/BRANCH_PERMISSION_MATRIX.md.
 * Used by resolveBranchAccessProfile to compute myAccess.permissions for the staff app.
 */

/** Role priority for deterministic selection (highest first). */
export const BRANCH_ROLE_PRIORITY = [
  "BRANCH_MANAGER",
  "DELIVERY_MANAGER",
  "ACCOUNTANT",
  "SELLER",
  "BRANCH_STAFF",
  "DELIVERY_STAFF",
  "CLINIC_STAFF",
] as const;

/** Base permissions always included when user has APPROVED branch access. */
export const BRANCH_BASE_PERMISSIONS = ["branch.view", "dashboard.view"];

/**
 * Permission keys per role for branch dashboard (sidebar, route guards).
 * Keys match BRANCH_PERMISSION_MATRIX.md and branchSidebarConfig requiredPerm.
 */
export const BRANCH_ROLE_PERMISSIONS: Record<string, string[]> = {
  BRANCH_MANAGER: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "tasks.assign",
    "approvals.view",
    "approvals.manage",
    "inventory.read",
    "inventory.receive",
    "inventory.adjust",
    "inventory.transfer",
    "inventory.transfer.approve",
    "inventory.ledger.view",
    "pos.view",
    "pos.sell",
    "pos.refund",
    "pos.discount.override",
    "cashdrawer.open",
    "cashdrawer.close",
    "services.view",
    "services.manage",
    "appointments.view",
    "appointments.manage",
    "customers.view",
    "customers.manage",
    "staff.view",
    "staff.manage",
    "shifts.view",
    "shifts.manage",
    "reports.view",
    "reports.export",
  ],
  BRANCH_STAFF: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "inventory.read",
    "pos.view",
    "pos.sell",
    "customers.view",
    "reports.view",
  ],
  SELLER: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "inventory.read",
    "pos.view",
    "pos.sell",
    "customers.view",
    "reports.view",
  ],
  DELIVERY_MANAGER: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "approvals.view",
    "inventory.read",
    "reports.view",
  ],
  DELIVERY_STAFF: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "inventory.read",
  ],
  CLINIC_STAFF: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "inventory.read",
    "services.view",
    "appointments.view",
    "customers.view",
  ],
  ACCOUNTANT: [
    "branch.view",
    "dashboard.view",
    "tasks.view",
    "approvals.view",
    "inventory.ledger.view",
    "pos.view",
    "pos.refund",
    "reports.view",
    "reports.export",
  ],
};

/** Default role when BranchMember.role is missing or unmapped. */
export const BRANCH_DEFAULT_ROLE = "BRANCH_STAFF";

/** Default permissions when role has no entry (minimal view). */
export const BRANCH_DEFAULT_PERMISSIONS = [
  "branch.view",
  "dashboard.view",
  "tasks.view",
  "inventory.read",
  "customers.view",
];
