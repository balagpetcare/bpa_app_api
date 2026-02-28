/**
 * Admin Approvals (Producer Governance). RBAC: admin.approvals.manage. Rate-limit mutations.
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const { governanceMutationLimiter } = require("../../../../middleware/rateLimiters");
const ctrl = require("./admin_approvals.controller");

const manage = requirePermission("admin.approvals.manage");

router.use(governanceTrace);

router.get("/", authenticateToken, requireAdmin, manage, ctrl.list);
router.post("/:id/approve", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.approve);
router.post("/:id/reject", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.reject);

module.exports = router;
export {};
