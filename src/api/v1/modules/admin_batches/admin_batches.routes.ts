/**
 * Admin Batch & Code Control. RBAC: admin.approvals.manage (same as approvals). Rate-limit mutations.
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const { governanceMutationLimiter } = require("../../../../middleware/rateLimiters");
const ctrl = require("./admin_batches.controller");

const manage = requirePermission("admin.approvals.manage");
const enforcementFreeze = requirePermission("admin.governance.enforcement.freeze");

router.use(governanceTrace);

router.get("/", authenticateToken, requireAdmin, manage, ctrl.list);
router.get("/:id", authenticateToken, requireAdmin, manage, ctrl.getDetail);
router.post("/:id/approve", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.approve);
router.post("/:id/reject", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.reject);
router.post("/:id/void", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.voidBatch);
router.post("/:id/freeze", governanceMutationLimiter, authenticateToken, requireAdmin, enforcementFreeze, ctrl.freeze);
router.post("/:id/unfreeze", governanceMutationLimiter, authenticateToken, requireAdmin, enforcementFreeze, ctrl.unfreeze);
router.post("/:id/archive", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.archive);

module.exports = router;
export {};
