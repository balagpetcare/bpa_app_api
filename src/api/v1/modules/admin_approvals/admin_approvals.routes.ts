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
const enforcementHide = requirePermission("admin.governance.enforcement.hide");

router.use(governanceTrace);

router.get("/", authenticateToken, requireAdmin, manage, ctrl.list);
router.get("/products/:productId/revisions", authenticateToken, requireAdmin, manage, ctrl.getProductRevisions);
router.get("/products/:productId/revisions/diff", authenticateToken, requireAdmin, manage, ctrl.getRevisionDiff);
router.get("/:id", authenticateToken, requireAdmin, manage, ctrl.getDetail);
router.post("/:id/approve", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.approve);
router.post("/:id/activate", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.activate);
router.post("/:id/reject", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.reject);
router.post("/:id/request-changes", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.requestChanges);
router.post("/:id/take", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.take);
router.post("/:id/release", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.release);
router.post("/products/:productId/archive", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.archiveProduct);
router.post("/products/:productId/unarchive", governanceMutationLimiter, authenticateToken, requireAdmin, manage, ctrl.unarchiveProduct);
router.post("/products/:productId/hide", governanceMutationLimiter, authenticateToken, requireAdmin, enforcementHide, ctrl.hideProduct);
router.post("/products/:productId/unhide", governanceMutationLimiter, authenticateToken, requireAdmin, enforcementHide, ctrl.unhideProduct);

module.exports = router;
export {};
