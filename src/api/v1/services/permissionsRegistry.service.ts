/**
 * Human-readable permissions registry (grouped).
 * Keys aligned with:
 *   - bpa_web/src/lib/permissionMenu.ts (required[] on menu items)
 *   - bpa_web/src/larkon-admin/menu/adapters/adminRouteMap.ts (admin routes)
 *   - PRODUCER_GOVERNANCE_MASTER_PLAN.md §3.3 (admin.producers.*, admin.approvals.*, producer.*)
 * Any permission used in UI but not discoverable from the above is added manually with a comment.
 */

export type PermissionScope = "admin" | "producer" | "both";

export type PermissionEntry = {
  key: string;
  label: string;
  group: string;
  description: string;
  scope: PermissionScope;
};

/** Ordered groups for display. Each group contains permissions in display order. */
const REGISTRY: PermissionEntry[] = [
  // ----- Admin (Governance) — Master plan §3.3 -----
  { key: "admin.producers.read", label: "View producers", group: "Governance", description: "List and view producer organizations and details.", scope: "admin" },
  { key: "admin.producers.write", label: "Manage producers", group: "Governance", description: "Suspend, unsuspend, and update flags/quotas for producer orgs.", scope: "admin" },
  { key: "admin.approvals.manage", label: "Manage approvals", group: "Governance", description: "Approve or reject pending producer product/batch approvals.", scope: "admin" },
  { key: "admin.kyc.manage", label: "Manage KYC", group: "Governance", description: "Review and decide on producer KYC verification.", scope: "admin" },
  { key: "admin.audit.read", label: "View audit logs", group: "Governance", description: "Read audit timeline and governance events.", scope: "admin" },
  { key: "admin.permissions.read", label: "View permissions registry", group: "Governance", description: "View human-readable permissions registry (grouped).", scope: "admin" },
  // ----- Producer panel (permissionMenu producer section) -----
  { key: "producer.org.read", label: "Producer org access", group: "Producer", description: "Access producer org context (approvals, staff).", scope: "producer" },
  // Producer governance groups (Batch, Product, KYC, Codes, Printing) — backend enforcement keys; not always in menu required[]
  { key: "producer.batches.enabled", label: "Batch creation", group: "Batch", description: "Feature flag: allow creating batches.", scope: "producer" },
  { key: "producer.products.enabled", label: "Product management", group: "Product", description: "Feature flag: allow product operations.", scope: "producer" },
  { key: "producer.printing.enabled", label: "Printing", group: "Printing", description: "Feature flag: allow print batch operations.", scope: "producer" },
  { key: "producer.codes.export.enabled", label: "Code export", group: "Codes", description: "Feature flag: allow code export.", scope: "producer" },
  { key: "producer.staff.invites.enabled", label: "Staff invites", group: "Producer", description: "Feature flag: allow staff invites.", scope: "producer" },
  // ----- Owner / shared (permissionMenu owner REGISTRY required[]) -----
  { key: "org.read", label: "View organizations", group: "My Business", description: "View organizations and org details.", scope: "both" },
  { key: "org.create", label: "Create organization", group: "My Business", description: "Create new organization.", scope: "both" },
  { key: "branch.read", label: "View branches", group: "My Business", description: "View branches.", scope: "both" },
  { key: "branch.create", label: "Create branch", group: "My Business", description: "Create new branch.", scope: "both" },
  { key: "staff.read", label: "View staff", group: "My Business", description: "View staff and access controls.", scope: "both" },
  { key: "staff.create", label: "Invite staff", group: "My Business", description: "Invite and create staff.", scope: "both" },
  { key: "product.read", label: "View products", group: "Products", description: "View products and catalog.", scope: "both" },
  { key: "product.create", label: "Create product", group: "Products", description: "Create and edit products.", scope: "both" },
  { key: "inventory.read", label: "View inventory", group: "Inventory", description: "View stock and inventory.", scope: "both" },
  { key: "orders.read", label: "View orders", group: "Orders", description: "View orders.", scope: "both" },
  { key: "orders.create", label: "Create orders", group: "Orders", description: "Create orders (e.g. POS).", scope: "both" },
  { key: "customers.read", label: "View customers", group: "People", description: "View customers.", scope: "both" },
  { key: "reports.read", label: "View reports", group: "Reports", description: "View reports and analytics.", scope: "both" },
  { key: "settings.read", label: "View settings", group: "Settings", description: "View settings.", scope: "both" },
  { key: "settings.manage", label: "Manage settings", group: "Settings", description: "Change settings.", scope: "both" },
  // ----- Clinic (permissionMenu clinic) -----
  { key: "service.read", label: "View services", group: "Clinic", description: "View clinic service catalog.", scope: "both" },
  { key: "clinic.appointments.read", label: "View appointments", group: "Clinic", description: "View clinic appointments.", scope: "both" },
  { key: "clinic.patients.read", label: "View patients", group: "Clinic", description: "View clinic patients.", scope: "both" },
  // ----- Country (permissionMenu country) — used in country panel and admin country governance -----
  { key: "country.dashboard.read", label: "Country dashboard", group: "Country Governance", description: "View country dashboard.", scope: "admin" },
  { key: "country.operations.read", label: "Country operations", group: "Country Governance", description: "View country operations (adoptions, donations, etc.).", scope: "admin" },
  { key: "country.moderation.read", label: "Country moderation", group: "Country Governance", description: "Content moderation at country level.", scope: "admin" },
  { key: "country.support.read", label: "Country support", group: "Country Governance", description: "Support tickets at country level.", scope: "admin" },
  { key: "country.orgs.read", label: "Country organizations", group: "Country Governance", description: "View organizations in country scope.", scope: "admin" },
  { key: "country.staff.read", label: "Country staff", group: "Country Governance", description: "View country staff.", scope: "admin" },
  { key: "country.staff.invite", label: "Country staff invite", group: "Country Governance", description: "Invite country staff.", scope: "admin" },
  { key: "country.compliance.read", label: "Country compliance", group: "Country Governance", description: "Compliance center.", scope: "admin" },
  { key: "country.reports.read", label: "Country reports", group: "Country Governance", description: "Country reports.", scope: "admin" },
  { key: "country.audit.read", label: "Country audit", group: "Country Governance", description: "Country audit logs.", scope: "admin" },
  { key: "country.profile.read", label: "Country profile", group: "Country Governance", description: "Country profile.", scope: "admin" },
  { key: "country.settings.features.read", label: "Country feature toggles", group: "Country Governance", description: "View country feature toggles.", scope: "admin" },
  { key: "country.settings.policies.read", label: "Country policies", group: "Country Governance", description: "View country policy rules.", scope: "admin" },
];

const GROUP_ORDER: string[] = [
  "Governance",
  "Producer",
  "Batch",
  "Product",
  "Printing",
  "Codes",
  "KYC",
  "My Business",
  "Products",
  "Inventory",
  "Orders",
  "People",
  "Reports",
  "Settings",
  "Clinic",
  "Country Governance",
];

/**
 * Returns permissions grouped by group key, in stable order.
 * Does not hit DB; registry is read-only and derived from UI/spec.
 */
export function getGroupedRegistry(): { group: string; permissions: PermissionEntry[] }[] {
  const byGroup = new Map<string, PermissionEntry[]>();
  for (const p of REGISTRY) {
    const list = byGroup.get(p.group) ?? [];
    list.push(p);
    byGroup.set(p.group, list);
  }
  const seen = new Set<string>();
  const ordered: { group: string; permissions: PermissionEntry[] }[] = [];
  for (const g of GROUP_ORDER) {
    if (byGroup.has(g) && !seen.has(g)) {
      seen.add(g);
      ordered.push({ group: g, permissions: byGroup.get(g)! });
    }
  }
  for (const [g, perms] of byGroup) {
    if (!seen.has(g)) ordered.push({ group: g, permissions: perms });
  }
  return ordered;
}
