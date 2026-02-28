/**
 * Admin Producer Governance routes.
 * Base path: /api/v1/admin/producers
 * RBAC: admin.producers.read (GET), admin.producers.write (mutations). Rate-limit mutations.
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const { governanceMutationLimiter } = require("../../../../middleware/rateLimiters");
const ctrl = require("./admin_producers.controller");

const read = requirePermission("admin.producers.read", "admin.audit.read");
const write = requirePermission("admin.producers.write");

router.use(governanceTrace);

router.get("/", authenticateToken, requireAdmin, read, ctrl.list);
router.get("/:orgId", authenticateToken, requireAdmin, read, ctrl.getOne);
router.post("/:orgId/suspend", governanceMutationLimiter, authenticateToken, requireAdmin, write, ctrl.suspend);
router.post("/:orgId/unsuspend", governanceMutationLimiter, authenticateToken, requireAdmin, write, ctrl.unsuspend);
router.get("/:orgId/staff", authenticateToken, requireAdmin, read, ctrl.getStaff);
router.get("/:orgId/flags", authenticateToken, requireAdmin, read, ctrl.getFlags);
router.put("/:orgId/flags", governanceMutationLimiter, authenticateToken, requireAdmin, write, ctrl.putFlags);
router.get("/:orgId/quotas", authenticateToken, requireAdmin, read, ctrl.getQuotas);
router.put("/:orgId/quotas", governanceMutationLimiter, authenticateToken, requireAdmin, write, ctrl.putQuotas);
router.get("/:orgId/audit", authenticateToken, requireAdmin, read, ctrl.getAudit);
router.get("/:orgId/metrics", authenticateToken, requireAdmin, read, ctrl.getMetrics);
router.get("/:orgId/print-jobs", authenticateToken, requireAdmin, read, ctrl.getPrintJobs);

module.exports = router;
export {};
