const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./sms.controller");

router.get("/balance", authenticateToken, requireAdmin, ctrl.requireSmsConfigured, ctrl.smsBalanceHandler);
router.post("/send", authenticateToken, requireAdmin, ctrl.requireSmsConfigured, ctrl.smsSendHandler);
router.post("/send-bulk", authenticateToken, requireAdmin, ctrl.requireSmsConfigured, ctrl.smsSendBulkHandler);
router.post("/test", authenticateToken, requireAdmin, ctrl.requireSmsConfigured, ctrl.smsTestHandler);

module.exports = router;
export {};
