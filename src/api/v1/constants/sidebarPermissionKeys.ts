/**
 * Canonical list of permission keys referenced by staff branch sidebar (bpa_web branchSidebarConfig).
 * Keep in sync with: bpa_web/src/lib/branchSidebarConfig.ts BRANCH_SIDEBAR[].items[].requiredPerm and anyPerms.
 * Used by guardrail tests to ensure registry and role mappings stay consistent.
 */

/** All permission keys that gate staff branch sidebar items (requiredPerm + anyPerms). */
export const BRANCH_SIDEBAR_PERMISSION_KEYS: string[] = [
  "dashboard.view",
  "tasks.view",
  "approvals.view",
  "inventory.read",
  "inventory.receive",
  "inventory.adjust",
  "inventory.transfer",
  "pos.view",
  "customers.view",
  "clinic.overview.read",
  "clinic.overview.manage",
  "clinic.appointments.read",
  "clinic.appointments.manage",
  "clinic.queue.read",
  "clinic.queue.manage",
  "clinic.patients.read",
  "clinic.patients.manage",
  "clinic.visits.read",
  "clinic.visits.manage",
  "staff.view",
  "reports.view",
];

/** Clinic group only: keys that must be present in at least one clinic role (CLINIC_STAFF or BRANCH_MANAGER). */
export const CLINIC_SIDEBAR_PERMISSION_KEYS: string[] = [
  "clinic.overview.read",
  "clinic.overview.manage",
  "clinic.appointments.read",
  "clinic.appointments.manage",
  "clinic.queue.read",
  "clinic.queue.manage",
  "clinic.patients.read",
  "clinic.patients.manage",
  "clinic.visits.read",
  "clinic.visits.manage",
];

/** Roles that are considered "clinic context" for guardrail: must between them include all CLINIC_SIDEBAR_PERMISSION_KEYS. */
export const CLINIC_CONTEXT_ROLES = ["CLINIC_STAFF", "BRANCH_MANAGER"] as const;
