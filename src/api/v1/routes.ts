const router = require("express").Router();

// Files (secure streaming for uploaded media)
// Must be registered near top so panels can render <img src="/api/v1/files/...">.
router.use(require("../../routes/files.routes"));

router.use("/auth", require("./modules/auth/auth.routes"));

router.use("/me", require("./modules/me/me.routes"));

// ✅ Admin panel namespace (keeps Flutter/public API untouched)
// All admin-only web panel endpoints MUST live under /api/v1/admin/*
router.use("/admin/auth", require("./modules/admin_auth/admin_auth.routes"));
router.use("/admin/branch-types", require("./modules/admin_branch_types/admin_branch_types.routes"));
router.use(
  "/admin/super-admin-whitelist",
  require("./modules/admin_super_admin_whitelist/admin_super_admin_whitelist.routes")
);
router.use("/admin/verifications", require("./modules/admin_verifications/admin_verifications.routes"));
// Admin dashboard widgets (counts, queues)
router.use("/admin/dashboard", require("./modules/admin_dashboard/admin_dashboard.routes"));
// V1 universal verification workflow (non-breaking, new endpoints)
router.use("/admin/verification-cases", require("./modules/admin_verification_cases/admin_verification_cases.routes"));
router.use("/admin/organizations", require("./modules/admin_organizations/admin_organizations.routes"));
router.use("/admin/branches", require("./modules/admin_branches/admin_branches.routes"));
router.use("/admin/audit", require("./modules/admin_audit/admin_audit.routes"));

router.use("/common", require("./modules/common/common.routes"));
router.use("/user", require("./modules/profile/profile.routes"));
router.use("/user/pets", require("./modules/pets/pets.routes"));

// Media 

router.use("/media", require("./modules/media/media.routes"));

// Locations (Division/District/Upazila/Area dropdowns + Dhaka tree)
router.use("/locations", require("./modules/locations/locations.routes"));

// Public master data (dropdowns)
router.use("/meta", require("./modules/meta/meta.routes"));

router.use("/posts", require("./modules/posts/posts.routes"));
router.use("/fundraising", require("./modules/fundraising/fundraising.routes"));

// Wallet (Donation credit + Withdraw reservations)
router.use('/wallet', require('./modules/wallet/wallet.routes'));

// Payout Webhooks (bKash/Nagad/Rocket)
router.use('/webhooks', require('./modules/webhooks/payout_webhooks.routes'));

// Partner onboarding (owner application -> org/branch -> publish)
router.use("/partner", require("./modules/partner_onboarding/partner_onboarding.routes"));

// Owner panel (organizations, branches, staff) — separate namespace
router.use("/owner", require("./modules/owner/owner.routes"));

// Branch namespace (staff actions)
router.use("/branches", require("./modules/branches/branches.routes"));

// BPA Admin approval endpoints (uses env allowlists)
router.use("/admin", require("./modules/partner_onboarding/admin_onboarding.routes"));

// Reports (posts, fundraising, users, pets)
router.use("/reports", require("./modules/reports/reports.routes"));

// Achievements
router.use("/achievements", require("./modules/achievements/achievements.routes"));


module.exports = router;

export {};
