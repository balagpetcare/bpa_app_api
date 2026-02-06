const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_roles.controller");

router.get("/", authenticateToken, requireAdmin, ctrl.list);
router.post("/", authenticateToken, requireAdmin, ctrl.create);
router.patch("/:id", authenticateToken, requireAdmin, ctrl.update);
router.post("/:id/clone", authenticateToken, requireAdmin, ctrl.clone);
router.post("/:id/permissions", authenticateToken, requireAdmin, ctrl.replacePermissions);

module.exports = router;
export {};
