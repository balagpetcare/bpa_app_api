const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");

const ctrl = require("./admin_auth.controller");

// Admin-only login: sets the same HttpOnly cookie as normal login,
// but will reject non-admin users (so web panel can't be used by normal users).
router.post("/login", ctrl.login);

// Admin-only profile/permissions
router.get("/me", authenticateToken, requireAdmin, ctrl.me);

// Admin-only logout (cookie clear)
router.post("/logout", ctrl.logout);

module.exports = router;

export {};
