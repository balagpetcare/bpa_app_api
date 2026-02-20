const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireCountryRole = require("../../../../middlewares/requireCountryRole");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./country_staff.controller");

router.get(
  "/roles",
  authenticateToken,
  requireCountryRole,
  requirePermission("country.staff.read"),
  ctrl.listRoles
);

router.get(
  "/",
  authenticateToken,
  requireCountryRole,
  requirePermission("country.staff.read"),
  ctrl.list
);

router.post(
  "/:userId/roles",
  authenticateToken,
  requireCountryRole,
  requirePermission("country.staff.manage"),
  ctrl.assignRole
);

router.delete(
  "/:userId/roles/:roleId",
  authenticateToken,
  requireCountryRole,
  requirePermission("country.staff.manage"),
  ctrl.removeRole
);

module.exports = router;
export {};
