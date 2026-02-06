const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireStateRole = require("../../../../middlewares/requireStateRole");
const ctrl = require("./state_access_invites.controller");

router.get("/", authenticateToken, requireStateRole, ctrl.list);
router.post("/", authenticateToken, requireStateRole, ctrl.create);
router.patch("/:id/revoke", authenticateToken, requireStateRole, ctrl.revoke);

module.exports = router;
export {};

