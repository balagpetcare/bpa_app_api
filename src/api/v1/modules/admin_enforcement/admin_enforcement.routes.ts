/**
 * Trust & Safety / Enforcement. RBAC: admin.governance.enforcement.cases | admin.governance.enforcement.actions
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const { governanceMutationLimiter } = require("../../../../middleware/rateLimiters");
const ctrl = require("./admin_enforcement.controller");

const casesPermission = requirePermission("admin.governance.enforcement.cases");
const actionsPermission = requirePermission("admin.governance.enforcement.actions");

router.use(governanceTrace);

router.get("/trace", authenticateToken, requireAdmin, casesPermission, ctrl.trace);
router.get("/cases/stats", authenticateToken, requireAdmin, casesPermission, ctrl.stats);
router.get("/cases", authenticateToken, requireAdmin, casesPermission, ctrl.list);
router.post("/cases", governanceMutationLimiter, authenticateToken, requireAdmin, casesPermission, ctrl.create);
router.get("/cases/:id", authenticateToken, requireAdmin, casesPermission, ctrl.getOne);
router.patch("/cases/:id", governanceMutationLimiter, authenticateToken, requireAdmin, casesPermission, ctrl.update);
router.post("/cases/:id/evidence", governanceMutationLimiter, authenticateToken, requireAdmin, casesPermission, ctrl.addEvidence);
router.post("/cases/:id/actions", governanceMutationLimiter, authenticateToken, requireAdmin, actionsPermission, ctrl.applyAction);
router.post("/actions/:id/revert", governanceMutationLimiter, authenticateToken, requireAdmin, actionsPermission, ctrl.revertAction);

module.exports = router;
export {};
