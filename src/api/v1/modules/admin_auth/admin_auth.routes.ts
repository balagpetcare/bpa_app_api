const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");

const ctrl = require("./admin_auth.controller");

// Login/logout are PUBLIC – no auth middleware. Login validates whitelist inside controller.
router.post("/login", ctrl.login);
router.post("/logout", ctrl.logout);

// Admin-only profile – requires auth + whitelist
router.get("/me", authenticateToken, requireAdmin, ctrl.me);

module.exports = router;

export {};
