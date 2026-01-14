const router = require("express").Router();

router.use("/auth", require("./modules/auth/auth.routes"));

// ✅ Admin panel compatibility: alias /admin/auth/me -> same as /auth/me
const authenticateToken = require("../../middleware/auth.middleware");
const authController = require("./modules/auth/auth.controller");
router.get("/admin/auth/me", authenticateToken, authController.getProfile);

router.use("/common", require("./modules/common/common.routes"));
router.use("/user", require("./modules/profile/profile.routes"));
router.use("/user/pets", require("./modules/pets/pets.routes"));

// Media 

router.use("/media", require("./modules/media/media.routes"));

router.use("/posts", require("./modules/posts/posts.routes"));
router.use("/fundraising", require("./modules/fundraising/fundraising.routes"));

// Wallet (Donation credit + Withdraw reservations)
router.use('/wallet', require('./modules/wallet/wallet.routes'));

// Payout Webhooks (bKash/Nagad/Rocket)
router.use('/webhooks', require('./modules/webhooks/payout_webhooks.routes'));

// Partner onboarding (owner application -> org/branch -> publish)
router.use("/partner", require("./modules/partner_onboarding/partner_onboarding.routes"));

// BPA Admin approval endpoints (uses env allowlists)
router.use("/admin", require("./modules/partner_onboarding/admin_onboarding.routes"));

// Reports (posts, fundraising, users, pets)
router.use("/reports", require("./modules/reports/reports.routes"));

// Achievements
router.use("/achievements", require("./modules/achievements/achievements.routes"));


module.exports = router;
