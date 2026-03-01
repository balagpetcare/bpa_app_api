const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const { requireProducerPermissionAny } = require("../../middlewares/producerAuth");
const ctrl = require("./producerDashboard.controller");

const dashboardPermission = ["producer.analytics.read", "producer.verification.read"];

router.get(
  "/summary",
  auth,
  requireProducerPermissionAny(dashboardPermission),
  ctrl.getSummary
);
router.get(
  "/trends",
  auth,
  requireProducerPermissionAny(dashboardPermission),
  ctrl.getTrends
);
router.get(
  "/top-products",
  auth,
  requireProducerPermissionAny(dashboardPermission),
  ctrl.getTopProducts
);
router.get(
  "/alerts",
  auth,
  requireProducerPermissionAny(dashboardPermission),
  ctrl.getAlerts
);

module.exports = router;
export {};
