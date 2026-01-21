const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_onboarding.controller");

// Partner applications
router.get("/partner/applications", authenticateToken, requireAdmin, ctrl.listPartnerApps);
router.post("/partner/applications/:id/approve", authenticateToken, requireAdmin, ctrl.approvePartnerApp);
router.post("/partner/applications/:id/reject", authenticateToken, requireAdmin, ctrl.rejectPartnerApp);

// Branch publish requests
router.get("/branches/publish-requests", authenticateToken, requireAdmin, ctrl.listPublishRequests);
router.post("/branches/publish-requests/:id/approve", authenticateToken, requireAdmin, ctrl.approvePublishRequest);
router.post("/branches/publish-requests/:id/reject", authenticateToken, requireAdmin, ctrl.rejectPublishRequest);

module.exports = router;

export {};
