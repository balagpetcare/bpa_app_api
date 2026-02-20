const router = require("express").Router();
const ctrl = require("./serials.controller");
const auth = require("../../../../middleware/auth.middleware");

// List serials (admin/internal)
router.get("/", auth, ctrl.listSerials);
// List scan events
router.get("/scan-events", auth, ctrl.listScanEvents);
// Fraud alerts
router.get("/fraud-alerts", auth, ctrl.listFraudAlerts);

// Public verify
router.get("/:sid/verify", ctrl.verifySerial);

// Authorized scan events (requires auth)
router.post("/:sid/scan-event", auth, ctrl.createScanEvent);

module.exports = router;
export {};
