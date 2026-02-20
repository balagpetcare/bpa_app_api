const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_permissions.controller");

router.get("/", authenticateToken, requireAdmin, ctrl.list);

module.exports = router;
export {};
