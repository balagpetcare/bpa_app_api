const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_country_users.controller");

router.get("/countries/:countryId/users", authenticateToken, requireAdmin, ctrl.list);
router.post("/countries/:countryId/users", authenticateToken, requireAdmin, ctrl.assign);
router.delete("/countries/:countryId/users/:userId/roles/:roleId", authenticateToken, requireAdmin, ctrl.remove);

module.exports = router;
export {};

