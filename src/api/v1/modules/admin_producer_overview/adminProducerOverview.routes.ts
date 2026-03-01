/**
 * Admin Producer Overview – system-wide KPIs, trends, top producers, alerts.
 * Base path: /api/v1/admin/producer-overview
 * Permission: admin.governance.analytics.read
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./adminProducerOverview.controller");

const readAnalytics = requirePermission("admin.governance.analytics.read");

router.get("/summary", authenticateToken, requireAdmin, readAnalytics, ctrl.getSummary);
router.get("/trends", authenticateToken, requireAdmin, readAnalytics, ctrl.getTrends);
router.get("/top-producers", authenticateToken, requireAdmin, readAnalytics, ctrl.getTopProducers);
router.get("/alerts", authenticateToken, requireAdmin, readAnalytics, ctrl.getAlerts);

module.exports = router;
export {};
