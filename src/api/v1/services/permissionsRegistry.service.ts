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
  { key: "admin.governance.products.review", label: "Review products", group: "Governance", description: "Take/release reviewer lock on product approvals.", scope: "admin" },
  { key: "admin.governance.products.approve", label: "Approve products", group: "Governance", description: "Approve or activate producer products.", scope: "admin" },
  { key: "admin.governance.products.request_changes", label: "Request product changes", group: "Governance", description: "Request changes on submitted/under-review products.", scope: "admin" },
  { key: "admin.governance.products.archive", label: "Archive products", group: "Governance", description: "Archive or unarchive rejected/inactive products.", scope: "admin" },
  { key: "admin.governance.batches.review", label: "Review batches", group: "Governance", description: "Review batch submissions.", scope: "admin" },
  { key: "admin.governance.batches.approve", label: "Approve batches", group: "Governance", description: "Approve or reject batches.", scope: "admin" },
  { key: "admin.governance.batches.allocate_codes", label: "Allocate codes", group: "Governance", description: "Allow code allocation for batches.", scope: "admin" },
  { key: "admin.governance.batches.void", label: "Void batches", group: "Governance", description: "Void batches (no verified codes).", scope: "admin" },
  { key: "admin.governance.enforcement.hide", label: "Hide products", group: "Governance", description: "Hide/unhide products (enforcement).", scope: "admin" },
  { key: "admin.governance.enforcement.freeze", label: "Freeze batches", group: "Governance", description: "Freeze batch printing/export.", scope: "admin" },
  { key: "admin.governance.enforcement.suspend", label: "Suspend producers", group: "Governance", description: "Suspend producer org with incident.", scope: "admin" },
  { key: "admin.governance.enforcement.cases", label: "Trust & Safety cases", group: "Governance", description: "Manage complaint cases, evidence, and trace.", scope: "admin" },
  { key: "admin.governance.enforcement.actions", label: "Enforcement actions", group: "Governance", description: "Apply or revert enforcement actions (freeze, quarantine, suspend).", scope: "admin" },
  { key: "admin.governance.incidents.manage", label: "Manage incidents", group: "Governance", description: "Create and resolve governance incidents.", scope: "admin" },
  { key: "admin.governance.analytics.read", label: "Governance analytics", group: "Governance", description: "View governance analytics.", scope: "admin" },
  { key: "admin.governance.code.search", label: "Code lookup", group: "Governance", description: "Search codes and trace producer/product/batch.", scope: "admin" },
  { key: "admin.kyc.manage", label: "Manage KYC", group: "Governance", description: "Review and decide on producer KYC verification.", scope: "admin" },
  { key: "admin.audit.read", label: "View audit logs", group: "Governance", description: "Read audit timeline and governance events.", scope: "admin" },
  { key: "admin.permissions.read", label: "View permissions registry", group: "Governance", description: "View human-readable permissions registry (grouped).", scope: "admin" },
  // ----- Support (ticketing) -----
  { key: "admin.support.tickets.manage", label: "Manage support tickets", group: "Support", description: "List, view, update, assign, and add internal notes on tickets.", scope: "admin" },
  { key: "admin.support.tickets.respond", label: "Respond to tickets", group: "Support", description: "Post public replies to producer tickets.", scope: "admin" },
  { key: "admin.support.tickets.assign", label: "Assign tickets", group: "Support", description: "Assign tickets to support agents.", scope: "admin" },
  { key: "admin.support.tickets.escalate", label: "Escalate to enforcement", group: "Support", description: "Escalate ticket to Trust & Safety case.", scope: "admin" },
  { key: "producer.tickets.read", label: "View support tickets", group: "Support", description: "View own org support tickets and messages.", scope: "producer" },
  { key: "producer.tickets.write", label: "Create and reply to tickets", group: "Support", description: "Create tickets, reply, close, and reopen.", scope: "producer" },
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
  { key: "inventory.receive", label: "Receive stock", group: "Inventory", description: "Receive stock at branch.", scope: "both" },
  { key: "inventory.adjust", label: "Adjust inventory", group: "Inventory", description: "Create and approve inventory adjustments.", scope: "both" },
  { key: "inventory.transfer", label: "Transfer inventory", group: "Inventory", description: "Create and manage inter-branch transfers.", scope: "both" },
  { key: "orders.read", label: "View orders", group: "Orders", description: "View orders.", scope: "both" },
  { key: "orders.create", label: "Create orders", group: "Orders", description: "Create orders (e.g. POS).", scope: "both" },
  { key: "customers.read", label: "View customers", group: "People", description: "View customers.", scope: "both" },
  { key: "customers.view", label: "View customers (branch)", group: "People", description: "View customers in staff branch context.", scope: "both" },
  { key: "reports.read", label: "View reports", group: "Reports", description: "View reports and analytics.", scope: "both" },
  { key: "reports.view", label: "View reports (branch)", group: "Reports", description: "View reports in staff branch context.", scope: "both" },
  { key: "settings.read", label: "View settings", group: "Settings", description: "View settings.", scope: "both" },
  // ----- Staff Branch (branchSidebarConfig) -----
  { key: "dashboard.view", label: "View dashboard", group: "Staff Branch", description: "View branch dashboard.", scope: "both" },
  { key: "tasks.view", label: "View tasks", group: "Staff Branch", description: "View and manage tasks.", scope: "both" },
  { key: "approvals.view", label: "View approvals", group: "Staff Branch", description: "View pending approvals.", scope: "both" },
  { key: "pos.view", label: "View POS", group: "Staff Branch", description: "Access POS / sales.", scope: "both" },
  { key: "staff.view", label: "View staff", group: "Staff Branch", description: "View staff and shifts.", scope: "both" },
  { key: "clinic.overview.manage", label: "Manage clinic overview", group: "Clinic Setup", description: "Manage clinic overview and settings.", scope: "both" },
  { key: "settings.manage", label: "Manage settings", group: "Settings", description: "Change settings.", scope: "both" },
  // ----- Clinic (permissionMenu clinic) -----
  { key: "service.read", label: "View services", group: "Clinic", description: "View clinic service catalog.", scope: "both" },
  { key: "clinic.appointments.read", label: "View appointments", group: "Clinic", description: "View clinic appointments.", scope: "both" },
  { key: "clinic.appointments.manage", label: "Manage appointments", group: "Clinic", description: "Create, cancel, reschedule appointments; check-in, no-show.", scope: "both" },
  { key: "clinic.appointments.collect_payment", label: "Collect payment", group: "Clinic", description: "Collect payment for appointments.", scope: "branch" },
  { key: "clinic.appointments.apply_discount", label: "Apply discount", group: "Clinic", description: "Apply discount on appointment payment.", scope: "branch" },
  { key: "clinic.appointments.reprint", label: "Reprint slips", group: "Clinic", description: "Reprint appointment or payment slips.", scope: "branch" },
  { key: "clinic.appointments.assign_doctor", label: "Assign doctor", group: "Clinic", description: "Assign doctor to Any Doctor appointments.", scope: "branch" },
  { key: "clinic.queue.read", label: "View queue", group: "Clinic", description: "View queue tickets and session.", scope: "both" },
  { key: "clinic.queue.manage", label: "Manage queue", group: "Clinic", description: "Issue tokens, call next, assign doctor, set priority, complete tickets.", scope: "both" },
  { key: "clinic.queue.screen", label: "View queue screen", group: "Clinic", description: "View PII-safe waiting screen (kiosk).", scope: "both" },
  { key: "clinic.patients.read", label: "View patients", group: "Clinic", description: "View clinic patients.", scope: "both" },
  { key: "clinic.patients.manage", label: "Manage patients", group: "Clinic", description: "Register and update pet/patient profiles.", scope: "both" },
  { key: "clinic.visits.read", label: "View visits", group: "Clinic", description: "View clinic visits and EMR.", scope: "both" },
  { key: "clinic.visits.manage", label: "Manage visits", group: "Clinic", description: "Create and update visits, vitals, notes.", scope: "both" },
  { key: "clinic.emr.read", label: "View EMR", group: "Clinic", description: "View visits, vitals, and clinical notes.", scope: "both" },
  { key: "clinic.emr.write", label: "Write EMR", group: "Clinic", description: "Create and update visits, vitals, SOAP notes.", scope: "both" },
  { key: "clinic.prescription.read", label: "View prescriptions", group: "Clinic", description: "View prescriptions and verify by QR.", scope: "both" },
  { key: "clinic.prescription.write", label: "Write prescriptions", group: "Clinic", description: "Create, finalize, and dispense prescriptions.", scope: "both" },
  { key: "clinic.lab.read", label: "View lab", group: "Clinic", description: "View lab requisitions and reports.", scope: "both" },
  { key: "clinic.lab.write", label: "Write lab", group: "Clinic", description: "Create requisitions and enter report results.", scope: "both" },
  // ----- Medicine Control (CCMLPA) -----
  { key: "medicine.policy.read", label: "View medicine policies", group: "Medicine Control", description: "View medicine policy and vial control rules.", scope: "both" },
  { key: "medicine.policy.manage", label: "Manage medicine policies", group: "Medicine Control", description: "Create and edit medicine policies (reuse, return, retention).", scope: "both" },
  { key: "medicine.dispense.request", label: "Request medicine dispense", group: "Medicine Control", description: "Create dispense requests for patient/visit.", scope: "both" },
  { key: "medicine.dispense.approve", label: "Approve dispense requests", group: "Medicine Control", description: "Approve dispense requests (pharmacy).", scope: "both" },
  { key: "medicine.dispense.issue", label: "Issue medicine", group: "Medicine Control", description: "Issue medicine from pharmacy (deduct stock).", scope: "both" },
  { key: "medicine.vial.open", label: "Open vial", group: "Medicine Control", description: "Open vial and start vial session.", scope: "both" },
  { key: "medicine.vial.use", label: "Log vial dose use", group: "Medicine Control", description: "Record dose consumption from open vial.", scope: "both" },
  { key: "medicine.vial.return", label: "Return vial", group: "Medicine Control", description: "Submit and close vial return.", scope: "both" },
  { key: "medicine.dose.record", label: "Record dose", group: "Medicine Control", description: "Record medication administration (dose).", scope: "both" },
  { key: "medicine.dose.read", label: "View dose records", group: "Medicine Control", description: "View medication administration records.", scope: "both" },
  { key: "medicine.return.submit", label: "Submit vial return", group: "Medicine Control", description: "Submit vial return for audit.", scope: "both" },
  { key: "medicine.return.verify", label: "Verify vial return", group: "Medicine Control", description: "Verify returned vials.", scope: "both" },
  { key: "medicine.audit.bin.view", label: "View audit bins", group: "Medicine Control", description: "View audit bins and items.", scope: "both" },
  { key: "medicine.audit.bin.manage", label: "Manage audit bins", group: "Medicine Control", description: "Create, seal, and manage audit bins.", scope: "both" },
  { key: "medicine.destruction.approve", label: "Approve destruction", group: "Medicine Control", description: "Approve and record destruction of held items.", scope: "both" },
  // ----- Clinic Setup (Owner Panel clinic pages) -----
  { key: "clinic.settings.read", label: "View clinic settings", group: "Clinic Setup", description: "View clinic settings (hours, specializations).", scope: "both" },
  { key: "clinic.settings.write", label: "Edit clinic settings", group: "Clinic Setup", description: "Edit clinic settings.", scope: "both" },
  { key: "clinic.services.manage", label: "Manage clinic services", group: "Clinic Setup", description: "Create, edit, delete clinic service catalog.", scope: "both" },
  { key: "clinic.overview.read", label: "View clinic overview", group: "Clinic Setup", description: "View clinic overview dashboard.", scope: "both" },
  { key: "clinic.rooms.manage", label: "Manage clinic rooms", group: "Clinic Setup", description: "Create, edit, deactivate clinic rooms/chambers.", scope: "both" },
  { key: "clinic.staff.manage", label: "Manage clinic staff profiles", group: "Clinic Setup", description: "Edit clinic staff profiles (type, license, fee, template).", scope: "both" },
  { key: "clinic.schedule.manage", label: "Manage clinic schedule templates", group: "Clinic Setup", description: "Edit doctor and room schedule templates.", scope: "both" },
  { key: "clinic.holidays.manage", label: "Manage clinic holidays", group: "Clinic Setup", description: "Add and remove branch holidays.", scope: "both" },
  { key: "clinic.emergency.manage", label: "Manage emergency slot policy", group: "Clinic Setup", description: "Configure emergency slot policy.", scope: "both" },
  { key: "clinic.fees.manage", label: "Manage clinic fees", group: "Clinic Setup", description: "Configure service fee overrides and view doctor fees.", scope: "both" },
  // ----- Clinical catalog (item master: medicines, consumables, instruments) -----
  { key: "catalog.manage", label: "Manage clinical catalog", group: "Clinical Catalog", description: "Admin: view and govern clinical item catalog.", scope: "admin" },
  { key: "catalog.category.manage", label: "Manage catalog categories", group: "Clinical Catalog", description: "Admin: manage clinical item categories.", scope: "admin" },
  { key: "catalog.audit.read", label: "View catalog audit", group: "Clinical Catalog", description: "Admin: view clinical item audit logs.", scope: "admin" },
  { key: "catalog.approval.manage", label: "Manage catalog approvals", group: "Clinical Catalog", description: "Admin: approve or reject clinical item requests.", scope: "admin" },
  { key: "clinic.items.read", label: "View clinical items", group: "Clinical Catalog", description: "View clinical catalog items and search.", scope: "both" },
  { key: "clinic.items.manage", label: "Manage clinical items", group: "Clinical Catalog", description: "Create, edit, activate/deactivate clinical items and categories.", scope: "both" },
  { key: "clinic.catalog.install", label: "Install catalog template", group: "Clinical Catalog", description: "Install master catalog template to clinic (org).", scope: "both" },
  { key: "clinic.stock.read", label: "View clinical stock", group: "Clinical Catalog", description: "View branch clinical item stock and low-stock alerts.", scope: "both" },
  // ----- Clinic Supply Chain (enterprise plan) -----
  { key: "clinic.supply.request.create", label: "Create supply request", group: "Clinic Supply Chain", description: "Create draft clinical supply request.", scope: "both" },
  { key: "clinic.supply.request.submit", label: "Submit supply request", group: "Clinic Supply Chain", description: "Submit supply request for owner review.", scope: "both" },
  { key: "clinic.supply.request.review", label: "Review supply request", group: "Clinic Supply Chain", description: "Owner: approve, reject, or modify supply requests.", scope: "both" },
  { key: "clinic.supply.transfer.dispatch", label: "Dispatch transfer", group: "Clinic Supply Chain", description: "Owner: dispatch clinical stock transfer.", scope: "both" },
  { key: "clinic.supply.transfer.receive", label: "Receive transfer", group: "Clinic Supply Chain", description: "Receive clinical stock transfer at branch.", scope: "both" },
  { key: "clinic.sterilization.manage", label: "Manage sterilization", group: "Clinic Supply Chain", description: "Start/complete sterilization cycles and view instruments.", scope: "both" },
  { key: "clinic.instrument.manage", label: "Manage instruments", group: "Clinic Supply Chain", description: "CRUD instrument instances and usage.", scope: "both" },
  { key: "clinic.audit.create", label: "Create stock audit", group: "Clinic Supply Chain", description: "Owner: create and run clinical stock audits.", scope: "both" },
  { key: "clinic.audit.approve", label: "Approve stock audit", group: "Clinic Supply Chain", description: "Owner: approve audit and post adjustments.", scope: "both" },
  { key: "clinic.wastage.report", label: "Report wastage", group: "Clinic Supply Chain", description: "Report clinical item wastage (expired, damaged, etc.).", scope: "both" },
  { key: "clinic.wastage.approve", label: "Approve wastage", group: "Clinic Supply Chain", description: "Owner: approve wastage and deduct stock.", scope: "both" },
  { key: "clinic.refill.view", label: "View refill suggestions", group: "Clinic Supply Chain", description: "View replenishment recommendations.", scope: "both" },
  { key: "clinic.refill.convert", label: "Convert to supply request", group: "Clinic Supply Chain", description: "Convert replenishment recommendations to supply request.", scope: "both" },
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
  // ----- Manager Operations (Branch Manager Control) -----
  { key: "manager.appointments.create", label: "Create appointments", group: "Manager Operations", description: "Create clinic appointments.", scope: "both" },
  { key: "manager.appointments.assign_doctor", label: "Assign doctor", group: "Manager Operations", description: "Assign doctor to appointments.", scope: "both" },
  { key: "manager.appointments.cancel", label: "Cancel appointments", group: "Manager Operations", description: "Cancel appointments.", scope: "both" },
  { key: "manager.appointments.reschedule", label: "Reschedule appointments", group: "Manager Operations", description: "Reschedule appointments.", scope: "both" },
  { key: "manager.walkin.register", label: "Register walk-in", group: "Manager Operations", description: "Register walk-in patients.", scope: "both" },
  { key: "manager.patients.create", label: "Create patients", group: "Manager Operations", description: "Create patient/pet records.", scope: "both" },
  { key: "manager.patients.edit", label: "Edit patients", group: "Manager Operations", description: "Edit patient/pet records.", scope: "both" },
  { key: "manager.patients.view_history", label: "View patient history", group: "Manager Operations", description: "View full patient visit history.", scope: "both" },
  { key: "manager.inventory.update_stock", label: "Update stock", group: "Manager Operations", description: "Update branch inventory stock.", scope: "both" },
  { key: "manager.inventory.supply_request", label: "Supply request", group: "Manager Operations", description: "Create supply requests.", scope: "both" },
  { key: "manager.inventory.purchase_request", label: "Purchase request", group: "Manager Operations", description: "Create purchase requests.", scope: "both" },
  { key: "manager.inventory.low_stock_alert", label: "Low stock alert", group: "Manager Operations", description: "View and act on low stock alerts.", scope: "both" },
  { key: "manager.services.enable_disable", label: "Enable/disable services", group: "Manager Operations", description: "Enable or disable branch-level services.", scope: "both" },
  { key: "manager.packages.activate", label: "Activate packages", group: "Manager Operations", description: "Activate packages at branch.", scope: "both" },
  { key: "manager.discount.apply", label: "Apply discount", group: "Manager Operations", description: "Apply discount within policy limit.", scope: "both" },
  { key: "manager.pricing.view", label: "View pricing", group: "Manager Operations", description: "View branch pricing.", scope: "both" },
  { key: "manager.staff.assign", label: "Assign staff", group: "Manager Operations", description: "Assign staff to branch/shifts.", scope: "both" },
  { key: "manager.staff.duty_roster", label: "Duty roster", group: "Manager Operations", description: "Manage duty roster.", scope: "both" },
  { key: "manager.staff.leave_approve", label: "Approve leave", group: "Manager Operations", description: "Approve staff leave requests.", scope: "both" },
  { key: "manager.staff.performance_view", label: "View staff performance", group: "Manager Operations", description: "View staff performance metrics.", scope: "both" },
  { key: "manager.billing.create_invoice", label: "Create invoice", group: "Manager Operations", description: "Create invoices.", scope: "both" },
  { key: "manager.billing.collect_payment", label: "Collect payment", group: "Manager Operations", description: "Collect payments.", scope: "both" },
  { key: "manager.billing.refund_request", label: "Refund request", group: "Manager Operations", description: "Request refund within policy.", scope: "both" },
  { key: "manager.reports.daily_revenue", label: "Daily revenue report", group: "Manager Operations", description: "View daily revenue report.", scope: "both" },
  { key: "manager.reports.doctor_performance", label: "Doctor performance report", group: "Manager Operations", description: "View doctor performance.", scope: "both" },
  { key: "manager.reports.inventory_usage", label: "Inventory usage report", group: "Manager Operations", description: "View inventory usage.", scope: "both" },
  { key: "manager.reports.export", label: "Export reports", group: "Manager Operations", description: "Export manager reports.", scope: "both" },
  { key: "manager.branch.settings", label: "Branch settings", group: "Manager Operations", description: "View/edit branch settings within policy.", scope: "both" },
  { key: "manager.branch.hours", label: "Branch hours", group: "Manager Operations", description: "View/edit branch hours.", scope: "both" },
  { key: "manager.branch.announcements", label: "Branch announcements", group: "Manager Operations", description: "Manage branch announcements.", scope: "both" },
];

const GROUP_ORDER: string[] = [
  "Governance",
  "Support",
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
  "Staff Branch",
  "Clinic",
  "Medicine Control",
  "Clinic Setup",
  "Clinical Catalog",
  "Clinic Supply Chain",
  "Country Governance",
  "Manager Operations",
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
