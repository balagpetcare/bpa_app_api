const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireCountryRole = require("../../../../middlewares/requireCountryRole");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./country_access_invites.controller");

router.get("/", authenticateToken, requireCountryRole, requirePermission("country.staff.read"), ctrl.list);
router.post("/", authenticateToken, requireCountryRole, requirePermission("country.staff.invite"), ctrl.create);
router.patch("/:id/revoke", authenticateToken, requireCountryRole, requirePermission("country.staff.manage"), ctrl.revoke);

module.exports = router;
export {};

