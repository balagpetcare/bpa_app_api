/**
 * Phase 4: Governance incidents. RBAC: admin.governance.incidents.manage.
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const { governanceMutationLimiter } = require("../../../../middleware/rateLimiters");
const ctrl = require("./admin_incidents.controller");

const incidentsManage = requirePermission("admin.governance.incidents.manage");

router.use(governanceTrace);

router.get("/stats", authenticateToken, requireAdmin, incidentsManage, ctrl.stats);
router.get("/", authenticateToken, requireAdmin, incidentsManage, ctrl.list);
router.post("/", governanceMutationLimiter, authenticateToken, requireAdmin, incidentsManage, ctrl.create);
router.get("/:id", authenticateToken, requireAdmin, incidentsManage, ctrl.getOne);
router.post("/:id/resolve", governanceMutationLimiter, authenticateToken, requireAdmin, incidentsManage, ctrl.resolve);

module.exports = router;
export {};
