import producerPrintAliasRouter from "./modules/producer/producerPrintAlias.routes";
const router = require("express").Router();
const countryScopeGuard = require("../../middlewares/countryScopeGuard");

// Files (secure streaming for uploaded media)
// Must be registered near top so panels can render <img src="/api/v1/files/...">.
router.use(require("../../routes/files.routes"));

router.use("/auth", require("./modules/auth/auth.routes"));

router.use("/me", require("./modules/me/me.routes"));
router.use("/notifications", require("./modules/notifications/notifications.routes"));

// ✅ Admin panel namespace (keeps Flutter/public API untouched)
// All admin-only web panel endpoints MUST live under /api/v1/admin/*
router.use("/admin/auth", require("./modules/admin_auth/admin_auth.routes"));
router.use("/admin/branch-types", require("./modules/admin_branch_types/admin_branch_types.routes"));
router.use(
  "/admin/super-admin-whitelist",
  require("./modules/admin_super_admin_whitelist/admin_super_admin_whitelist.routes")
);
router.use("/admin/verifications", require("./modules/admin_verifications/admin_verifications.routes"));
router.use("/admin/producers", require("./modules/admin_producers/admin_producers.routes"));
router.use("/admin/approvals", require("./modules/admin_approvals/admin_approvals.routes"));
// Governance-related admin modules with 503 fallback if load fails
function mountWith503(path: string, modulePath: string) {
  try {
    router.use(path, require(modulePath));
  } catch (err) {
    console.error(`[routes] ${path} failed to load:`, err);
    router.use(path, (_req: any, res: any) =>
      res.status(503).json({ success: false, message: `${path} not loaded; check server logs and restart API.` }));
  }
}
mountWith503("/admin/batches", "./modules/admin_batches/admin_batches.routes");
mountWith503("/admin/governance", "./modules/admin_governance/admin_governance.routes");
mountWith503("/admin/incidents", "./modules/admin_incidents/admin_incidents.routes");
mountWith503("/admin/enforcement", "./modules/admin_enforcement/admin_enforcement.routes");
router.use("/admin/support/tickets", require("./modules/admin_support/admin_support.routes"));
router.use("/admin/verification-metrics", require("./modules/admin_verification_metrics/admin_verification_metrics.routes"));
// Admin dashboard widgets (counts, queues)
router.use("/admin/dashboard", require("./modules/admin_dashboard/admin_dashboard.routes"));
// Admin producer system overview (KPIs, trends, top producers, alerts)
router.use("/admin/producer-overview", require("./modules/admin_producer_overview/adminProducerOverview.routes"));
const authenticateToken = require("../../middleware/auth.middleware");
const requireAdmin = require("../../middleware/admin.middleware");
const requirePermission = require("../../middlewares/requirePermission");
const adminVendorAnalyticsCtrl = require("./modules/ai_intelligence/adminVendorAnalytics.controller");
router.get(
  "/admin/vendor-analytics",
  authenticateToken,
  requireAdmin,
  requirePermission("admin.vendor.analytics.read"),
  adminVendorAnalyticsCtrl.getSummary
);
// Admin code lookup (trace code -> batch -> product -> org, verification history, block/unblock)
router.use("/admin/code-lookup", require("./modules/admin_code_lookup/adminCodeLookup.routes"));
// V1 universal verification workflow (non-breaking, new endpoints)
router.use("/admin/verification-cases", require("./modules/admin_verification_cases/admin_verification_cases.routes"));
router.use("/admin/organizations", require("./modules/admin_organizations/admin_organizations.routes"));
router.use("/admin/branches", require("./modules/admin_branches/admin_branches.routes"));
router.use("/admin/audit", require("./modules/admin_audit/admin_audit.routes"));
router.use("/admin/clinical-catalog", require("./modules/admin_clinical_catalog/admin_clinical_catalog.routes"));
router.use("/admin/medicine-catalog-import", require("./modules/admin_medicine_import/admin_medicine_import.routes"));
router.use("/admin/medicine", require("./modules/admin_medicine/admin_medicine.workspace.routes"));
router.use("/admin/medicine-catalog", require("./modules/admin_medicine_catalog/admin_medicine_catalog.routes"));
router.use("/admin/inventory", require("./modules/admin_inventory/admin_inventory.routes"));
router.use("/admin/users", require("./modules/admin_users/admin_users.routes"));
router.use("/admin/staff", require("./modules/admin_staff/admin_staff.routes"));
router.use("/admin/roles", require("./modules/admin_roles/admin_roles.routes"));
router.use("/admin/permissions", require("./modules/admin_permissions/admin_permissions.routes"));
router.use("/admin/user-roles", require("./modules/admin_user_roles/admin_user_roles.routes"));
router.use("/admin/countries", require("./modules/admin_countries/admin_countries.routes"));
router.use("/admin/country", require("./modules/admin_country_policies/admin_country_policies.routes"));
router.use("/admin/country", require("./modules/admin_country_users/admin_country_users.routes"));
router.use("/admin/access-invites", require("./modules/admin_access_invites/admin_access_invites.routes"));
router.use("/admin/states", require("./modules/admin_states/admin_states.routes"));
router.use("/admin/state", require("./modules/admin_state_policies/admin_state_policies.routes"));
const adsModule = require("./modules/ads/ads.routes");
router.use("/admin/ads", adsModule.adminRoutes || adsModule);

router.use("/common", require("./modules/common/common.routes"));
router.use("/user", require("./modules/profile/profile.routes"));
router.use("/user/pets", require("./modules/pets/pets.routes"));

// Media

router.use("/media", require("./modules/media/media.routes"));

// Phase 4: Ads (public serve – no auth; country from X-Country-Code)
router.use("/ads", require("./modules/ads/ads.routes"));

// Locations (legacy BD hierarchy – UI uses /geo for unified; these kept for backward compat)
router.use("/locations", require("./modules/locations/locations.routes"));

// Geo (static countries/states + Nominatim proxy - no DB for dropdowns)
router.use("/geo", require("./modules/geo/geo.routes"));

// Public master data (dropdowns)
router.use("/meta", require("./modules/meta/meta.routes"));

// Planning/docs (served for Next.js admin panel) – mount explicitly so /docs/list and /docs/:slug are registered
const docsController = require("./modules/docs/docs.controller");
router.get("/docs/list", docsController.listDocs);
router.get("/docs/:slug", docsController.getDoc);

router.use("/posts", require("./modules/posts/posts.routes"));
router.use("/fundraising", countryScopeGuard, require("./modules/fundraising/fundraising.routes"));

// Wallet (Donation credit + Withdraw reservations)
router.use('/wallet', require('./modules/wallet/wallet.routes'));

// Payout Webhooks (bKash/Nagad/Rocket)
router.use('/webhooks', require('./modules/webhooks/payout_webhooks.routes'));

// Partner onboarding (owner application -> org/branch -> publish)
router.use("/partner", require("./modules/partner_onboarding/partner_onboarding.routes"));

// Owner clinic master catalog (browse) — register on main router so GET always matches (fix 404)
const auth = require("../../middlewares/auth");
const ownerPanelGuard = require("../../middlewares/ownerPanelGuard");
const { requireOwnerPermission } = require("../../middlewares/requireOwnerScope");
const ownerClinicCtrl = require("./modules/owner/ownerClinic.controller");
const ownerMasterCatalogChain = [
  auth,
  countryScopeGuard,
  ownerPanelGuard(),
  requireOwnerPermission("clinic.services.manage", "branch"),
];
router.get(
  "/owner/clinic/branches/:branchId/catalog/master/categories",
  ownerMasterCatalogChain,
  ownerClinicCtrl.listMasterCatalogCategories
);
router.get(
  "/owner/clinic/branches/:branchId/catalog/master/items",
  ownerMasterCatalogChain,
  ownerClinicCtrl.listMasterCatalogItems
);
router.post(
  "/owner/clinic/branches/:branchId/catalog/add-from-master/preview",
  ownerMasterCatalogChain,
  ownerClinicCtrl.previewAddFromMasterCatalog
);
router.post(
  "/owner/clinic/branches/:branchId/catalog/add-from-master/execute",
  ownerMasterCatalogChain,
  ownerClinicCtrl.executeAddFromMasterCatalog
);
router.get(
  "/owner/clinic/branches/:branchId/catalog/templates",
  ownerMasterCatalogChain,
  ownerClinicCtrl.listCatalogTemplates
);
router.get(
  "/owner/clinic/branches/:branchId/catalog/templates/:templateId",
  ownerMasterCatalogChain,
  ownerClinicCtrl.getCatalogTemplateById
);
router.get(
  "/owner/clinic/branches/:branchId/catalog/install-history",
  ownerMasterCatalogChain,
  ownerClinicCtrl.getCatalogInstallHistory
);
// Package by id — register on main router so GET always matches (fix 404 for detail/edit)
router.get(
  "/owner/clinic/branches/:branchId/packages/:packageId",
  ownerMasterCatalogChain,
  ownerClinicCtrl.getClinicPackageById
);
// Package audit log — register on main router so GET always matches (fix 404)
router.get(
  "/owner/clinic/branches/:branchId/packages/:packageId/audit-log",
  ownerMasterCatalogChain,
  ownerClinicCtrl.getClinicPackageAuditLog
);

// Owner panel (organizations, branches, staff) — separate namespace
router.use("/owner", countryScopeGuard, require("./modules/owner/owner.routes"));

// Workspace (tasks, alerts, approvals) — role-aware: Owner / Manager / Staff
router.use("/workspace", countryScopeGuard, require("./modules/workspace/workspace.routes"));

// Country admin namespace (RBAC-enforced)
router.use("/country/access-invites", require("./modules/country_access_invites/country_access_invites.routes"));
router.use("/country/staff", require("./modules/country_staff/country_staff.routes"));

// Branch namespace (staff actions)
router.use("/branches", countryScopeGuard, require("./modules/branches/branches.routes"));

// Branch Manager namespace (manager dashboard APIs, KPIs, staff overview)
router.use("/branches", countryScopeGuard, require("./modules/branch_manager/branch_manager.routes"));

// Branch Access Permissions (multi-branch staff permission system)
router.use("/branch-access", countryScopeGuard, require("./modules/branch_access/branch_access.routes"));

// Manager API (dashboard, staff, reports, escalations — branch manager control)
router.use("/manager", countryScopeGuard, require("./modules/manager/manager.routes"));

// BPA Admin approval endpoints (uses env allowlists)
router.use("/admin", require("./modules/partner_onboarding/admin_onboarding.routes"));

// Reports (posts, fundraising, users, pets)
router.use("/reports", require("./modules/reports/reports.routes"));

// Achievements
router.use("/achievements", require("./modules/achievements/achievements.routes"));

// Products (MVP Core Feature)
router.use("/products", countryScopeGuard, require("./modules/products/products.routes"));

// State admin namespace (RBAC-enforced)
router.use("/state/access-invites", require("./modules/state_access_invites/state_access_invites.routes"));

// Product authenticity (MVP) - batch + serial
router.use("/batches", countryScopeGuard, require("./modules/batches/batches.routes"));
router.use("/serials", countryScopeGuard, require("./modules/serials/serials.routes"));
router.use("/factories", countryScopeGuard, require("./modules/factories/factories.routes"));

// Producer/Auth system (separate) – dashboard before /producer so /producer/dashboard/* is matched
router.use("/producer/dashboard", require("./modules/producer_dashboard/producerDashboard.routes"));
router.use("/producer", require("./modules/producer/producer.routes"));
router.use("/producer/tickets", require("./modules/producer_tickets/producer_tickets.routes"));
// Producer-print alias: same issuance download at /api/v1/producer-print/issuances/:issuanceId/download
router.use("/producer-print", producerPrintAliasRouter);
// TEMP: remove after verification
router.get("/__route_probe/producer-print", (_req: any, res: any) => res.json({ ok: true }));
router.get("/__route_probe/admin-governance-products", (_req: any, res: any) => res.status(200).json({ ok: true }));

// Warehouse (MVP Core Feature)
router.use("/warehouse", countryScopeGuard, require("./modules/warehouse/warehouse.routes"));

// Inventory (MVP Core Feature)
router.use("/inventory", countryScopeGuard, require("./modules/inventory/inventory.routes"));
router.use("/network-balance", countryScopeGuard, require("./modules/network_balance/networkBalance.routes"));
router.use("/reverse-logistics", countryScopeGuard, require("./modules/reverse_logistics/reverseLogistics.routes"));

// Orders (MVP Core Feature)
router.use("/orders", countryScopeGuard, require("./modules/orders/orders.routes"));

// POS System (MVP Core Feature)
router.use("/pos", countryScopeGuard, require("./modules/pos/pos.routes"));

// Clinic (Appointment + Queue) — staff panel: /api/v1/clinic/branches/:branchId/...
// Patient clinical overview — **sole** registration for this path (not in clinic.routes.ts; avoids stale partial dist).
// See docs/DEV_API_RUN_AND_DIST.md (npm run dev vs npm start).
const clinicPatientOverviewCtrl = require("./modules/clinic/clinic.controller");
const authenticateTokenClinicPatient = require("../../middleware/auth.middleware");
const { requireClinicPermission: requireClinicPermPatientOverview } = require("./modules/clinic/clinic.middleware");
router.get(
  "/clinic/branches/:branchId/patients/:petId/clinical-overview",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermPatientOverview("clinic.patients.read", "clinic.patients.manage"),
  clinicPatientOverviewCtrl.getPatientClinicalOverview
);
// Services & Pricing matrix — registered here first (same pattern as clinical-overview) so `npm start` + dist
// always picks it up even when dist/clinic.routes.js is stale. Still declared in clinic.routes.ts for dev clarity.
router.get(
  "/clinic/branches/:branchId/service-pricing/matrix",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermPatientOverview(
    "manager.pricing.view",
    "clinic.services.manage",
    "clinic.appointments.read",
    "clinic.appointments.manage"
  ),
  clinicPatientOverviewCtrl.getServicePricingMatrix
);
// Service pricing audit trail — early mount (same rationale as matrix; see DEV_API_RUN_AND_DIST.md).
router.get(
  "/clinic/branches/:branchId/services/:serviceId(\\d+)/pricing-history",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermPatientOverview("clinic.services.manage", "manager.pricing.view", "clinic.appointments.manage"),
  clinicPatientOverviewCtrl.getServicePricingHistory
);
// Doctor service assignment (enterprise UI) — early mount (same pattern as clinical-overview / service-pricing matrix).
// Ensures `npm start` + stale dist still matches these paths; see docs/DEV_API_RUN_AND_DIST.md.
// Static .../service-assignment/* MUST register before .../doctors/:memberId/service-assignment on this router.
const staffDoctorCtrlEarly = require("./modules/clinic/staffDoctorManagement.controller");
const { requireClinicPermission: requireClinicPermStaffDoctor } = require("./modules/clinic/clinic.middleware");
router.get(
  "/clinic/branches/:branchId/doctors/service-assignment/summary",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.view", "clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.getServiceAssignmentSummary
);
router.get(
  "/clinic/branches/:branchId/doctors/service-assignment/templates",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.view", "clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.getServiceAssignmentTemplates
);
router.post(
  "/clinic/branches/:branchId/doctors/service-assignment/templates",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.postServiceAssignmentTemplate
);
router.patch(
  "/clinic/branches/:branchId/doctors/service-assignment/templates/:templateId",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.patchServiceAssignmentTemplate
);
router.delete(
  "/clinic/branches/:branchId/doctors/service-assignment/templates/:templateId",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.deleteServiceAssignmentTemplate
);
router.post(
  "/clinic/branches/:branchId/doctors/service-assignment/templates/:templateId/apply",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.postApplyServiceAssignmentTemplate
);
router.get(
  "/clinic/branches/:branchId/doctors/:memberId/service-assignment",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.view", "clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.getServiceAssignmentDetail
);
router.patch(
  "/clinic/branches/:branchId/doctors/:memberId/service-assignment/bulk",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermStaffDoctor("clinic.doctors.manage_services"),
  staffDoctorCtrlEarly.patchServiceAssignmentBulk
);
// Clinic approval-requests summary (doctor queue KPIs) — early mount so `npm start` + stale dist
// still matches GET .../approval-requests/summary; must stay before .../approval-requests/:requestId
// on any router that could treat "summary" as an id. See docs/DEV_API_RUN_AND_DIST.md.
router.get(
  "/clinic/branches/:branchId/approval-requests/summary",
  countryScopeGuard,
  authenticateTokenClinicPatient,
  requireClinicPermPatientOverview("approvals.view", "clinic.packages.read"),
  clinicPatientOverviewCtrl.getClinicApprovalRequestsSummary
);
router.use("/clinic", countryScopeGuard, require("./modules/clinic/clinic.routes"));

// Vet reference (public): countries, regulatory bodies, doc types for doctor verification
router.use("/vet-reference", require("./modules/doctor/vetReference.routes"));
// Doctor panel auth (login/logout) — must be before /doctor so /doctor/auth/* is matched
router.use("/doctor/auth", require("./modules/doctor_auth/doctor_auth.routes"));
// Doctor panel — unified view across all clinics
router.use("/doctor", countryScopeGuard, require("./modules/doctor/doctor.routes"));

// Services (Clinic MVP Feature)
router.use("/services", countryScopeGuard, require("./modules/services/services.routes"));

// Reports (MVP Core Feature)
router.use("/reports", require("./modules/reports/reports.routes"));

// ============================
// Products Module Routes
// ============================

// Transfers
router.use("/transfers", countryScopeGuard, require("./modules/transfers/transfers.routes"));

// Stock Requests (branch request → owner fulfill → dispatch → receive)
router.use("/stock-requests", countryScopeGuard, require("./modules/stock_requests/stock_requests.routes"));

// AI Intelligence Phase 4 (forecast, replenishment, procurement, control tower)
router.use("/ai", countryScopeGuard, require("./modules/ai_intelligence/ai_intelligence.routes"));

// Wave-4: financial intelligence, SLA, operational command center
router.use("/intelligence", countryScopeGuard, require("./modules/operational_intelligence/operationalIntelligence.routes"));
router.use("/operations/command-center", countryScopeGuard, require("./modules/operational_intelligence/commandCenter.routes"));

// Wave-5: executive control tower, decision assist, scenario planning (read-heavy; writes are audit/governance only)
router.use("/executive-tower", countryScopeGuard, require("./modules/executive_tower/executiveTower.routes"));

// Medicine Requisitions (pharmacy supply chain: branch → owner review → FEFO dispatch → receive)
router.use("/medicine-requisitions", countryScopeGuard, require("./modules/medicine_requisitions/medicine_requisitions.routes"));

// Central Warehouse Module (warehouse CRUD, staff, delivery assignments) - REMOVED: Duplicate registration, using line 231 instead
router.use("/purchase-orders", countryScopeGuard, require("./modules/purchase_orders/purchaseOrder.routes"));
router.use("/purchase-requisitions", countryScopeGuard, require("./modules/purchase_requisitions/purchaseRequisition.routes"));
router.use("/inbound-shipments", countryScopeGuard, require("./modules/inbound_shipments/inboundShipment.routes"));
router.use("/inbound-discrepancies", countryScopeGuard, require("./modules/inbound_discrepancies/inboundDiscrepancy.routes"));
router.use("/putaway", countryScopeGuard, require("./modules/putaway/putaway.routes"));
router.use("/allocation-plans", countryScopeGuard, require("./modules/allocation_plans/allocationPlan.routes"));
router.use("/fulfillment", countryScopeGuard, require("./modules/fulfillment/fulfillment.routes"));
router.use("/pick-lists", countryScopeGuard, require("./modules/pick_lists/pickList.routes"));
router.use("/qc-inspections", countryScopeGuard, require("./modules/qc_inspections/qcInspection.routes"));

// Online Store (aggregated ONLINE_HUB stock)
router.use("/online-store", countryScopeGuard, require("./modules/online-store/online-store.routes"));

// Returns
router.use("/returns", countryScopeGuard, require("./modules/returns/returns.routes"));

// Vendors
router.use("/vendors", countryScopeGuard, require("./modules/vendors/vendors.routes"));

// Vendor payments (credit in vendor ledger)
router.use("/vendor-payments", countryScopeGuard, require("./modules/vendor_payments/vendor_payments.routes"));

// GRN (Goods Received Note) - stock-in to location via vendor
router.use("/grn", countryScopeGuard, require("./modules/grn/grn.routes"));

// Catalog Enable Request (branch asks to enable product/variant for selling)
router.use("/catalog-requests", countryScopeGuard, require("./modules/catalog_requests/catalog_requests.routes"));

// Pricing
router.use("/pricing", countryScopeGuard, require("./modules/pricing/pricing.routes"));

// Location variant config (mounted under inventory)
router.post(
  "/inventory/locations/:locationId/variants/:variantId/enable",
  require("../../middleware/auth.middleware"),
  require("./modules/pricing/pricing.controller").enableLocationVariant
);

module.exports = router;

export {};
