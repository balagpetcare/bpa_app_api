const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_sms.controller");

router.get("/dashboard", authenticateToken, requireAdmin, ctrl.getDashboard);
router.get("/balance", authenticateToken, requireAdmin, ctrl.getBalance);
router.get("/logs", authenticateToken, requireAdmin, ctrl.getLogs);
router.post("/send", authenticateToken, requireAdmin, ctrl.sendSingle);
router.post("/bulk", authenticateToken, requireAdmin, ctrl.sendBulk);
router.post("/campaign", authenticateToken, requireAdmin, ctrl.sendCampaign);
router.post("/retry/:id", authenticateToken, requireAdmin, ctrl.retryFailed);

module.exports = router;

export {};
