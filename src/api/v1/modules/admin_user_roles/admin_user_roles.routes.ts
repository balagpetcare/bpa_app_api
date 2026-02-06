/**
 * Phase 4: Admin routes for Global + Country role assignments.
 */

const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const admin = require("../../../../middleware/adminMiddleware");
const ctrl = require("./admin_user_roles.controller");

// List available roles by scope
router.get("/global-roles", auth, admin, ctrl.listGlobalRoles);
router.get("/country-roles", auth, admin, ctrl.listCountryRoles);

// User global role assignments
router.get("/users/:userId/global-roles", auth, admin, ctrl.listUserGlobalRoles);
router.post("/users/:userId/global-roles", auth, admin, ctrl.assignUserGlobalRole);
router.delete("/users/:userId/global-roles/:roleId", auth, admin, ctrl.removeUserGlobalRole);

// User country role assignments
router.get("/users/:userId/country-roles", auth, admin, ctrl.listUserCountryRoles);
router.post("/users/:userId/country-roles", auth, admin, ctrl.assignUserCountryRole);
router.delete("/users/:userId/country-roles/:countryId/:roleId", auth, admin, ctrl.removeUserCountryRole);

module.exports = router;
export {};
