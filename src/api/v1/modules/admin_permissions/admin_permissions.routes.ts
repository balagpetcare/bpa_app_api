/**
 * Admin Permissions registry. RBAC: admin.permissions.read
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const ctrl = require("./admin_permissions.controller");

router.use(governanceTrace);
router.get("/", authenticateToken, requireAdmin, requirePermission("admin.permissions.read"), ctrl.list);

module.exports = router;
export {};
