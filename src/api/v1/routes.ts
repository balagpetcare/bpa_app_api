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
router.use("/admin/verification-metrics", require("./modules/admin_verification_metrics/admin_verification_metrics.routes"));
// Admin dashboard widgets (counts, queues)
router.use("/admin/dashboard", require("./modules/admin_dashboard/admin_dashboard.routes"));
// V1 universal verification workflow (non-breaking, new endpoints)
router.use("/admin/verification-cases", require("./modules/admin_verification_cases/admin_verification_cases.routes"));
router.use("/admin/organizations", require("./modules/admin_organizations/admin_organizations.routes"));
router.use("/admin/branches", require("./modules/admin_branches/admin_branches.routes"));
router.use("/admin/audit", require("./modules/admin_audit/admin_audit.routes"));
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

// Locations (Division/District/Upazila/Area dropdowns + Dhaka tree)
router.use("/locations", require("./modules/locations/locations.routes"));

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

// Owner panel (organizations, branches, staff) — separate namespace
router.use("/owner", countryScopeGuard, require("./modules/owner/owner.routes"));

// Country admin namespace (RBAC-enforced)
router.use("/country/access-invites", require("./modules/country_access_invites/country_access_invites.routes"));
router.use("/country/staff", require("./modules/country_staff/country_staff.routes"));

// Branch namespace (staff actions)
router.use("/branches", countryScopeGuard, require("./modules/branches/branches.routes"));

// Branch Manager namespace (manager dashboard APIs, KPIs, staff overview)
router.use("/branches", countryScopeGuard, require("./modules/branch_manager/branch_manager.routes"));

// Branch Access Permissions (multi-branch staff permission system)
router.use("/branch-access", countryScopeGuard, require("./modules/branch_access/branch_access.routes"));

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

// Producer/Auth system (separate)
router.use("/producer", require("./modules/producer/producer.routes"));

// Inventory (MVP Core Feature)
router.use("/inventory", countryScopeGuard, require("./modules/inventory/inventory.routes"));

// Orders (MVP Core Feature)
router.use("/orders", countryScopeGuard, require("./modules/orders/orders.routes"));

// POS System (MVP Core Feature)
router.use("/pos", countryScopeGuard, require("./modules/pos/pos.routes"));

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

// Online Store (aggregated ONLINE_HUB stock)
router.use("/online-store", countryScopeGuard, require("./modules/online-store/online-store.routes"));

// Returns
router.use("/returns", countryScopeGuard, require("./modules/returns/returns.routes"));

// Vendors
router.use("/vendors", countryScopeGuard, require("./modules/vendors/vendors.routes"));

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
