const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_access_invites.controller");

router.get("/", authenticateToken, requireAdmin, ctrl.list);
router.post("/", authenticateToken, requireAdmin, ctrl.create);
router.patch("/:id/revoke", authenticateToken, requireAdmin, ctrl.revoke);

module.exports = router;
export {};

