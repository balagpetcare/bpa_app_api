/**
 * Phase 4: Ads – public serve (no auth) + admin CRUD.
 */

const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const admin = require("../../../../middleware/adminMiddleware");
const ctrl = require("./ads.controller");

// Public: serve ads for current country (from X-Country-Code or default). Returns [] if ADS disabled.
router.get("/serve", ctrl.serve);

// Admin CRUD (mounted at /api/v1/admin/ads)
const adminRoutes = require("express").Router();
adminRoutes.get("/", auth, admin, ctrl.adminList);
adminRoutes.post("/", auth, admin, ctrl.adminCreate);
adminRoutes.patch("/:id", auth, admin, ctrl.adminUpdate);
adminRoutes.delete("/:id", auth, admin, ctrl.adminDelete);

module.exports = router;
module.exports.adminRoutes = adminRoutes;
export {};
