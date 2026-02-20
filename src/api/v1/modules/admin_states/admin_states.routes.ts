const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_states.controller");

router.get("/", authenticateToken, requireAdmin, ctrl.list);
router.post("/", authenticateToken, requireAdmin, ctrl.create);
router.patch("/:id", authenticateToken, requireAdmin, ctrl.update);

module.exports = router;
export {};

