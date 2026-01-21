const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_users.controller");

// GET /api/v1/admin/users?q=...
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// POST /api/v1/admin/users
router.post("/", authenticateToken, requireAdmin, ctrl.create);

// PATCH /api/v1/admin/users/:id  (status/displayName/email/phone)
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

// PATCH /api/v1/admin/users/:id/password
router.patch("/:id/password", authenticateToken, requireAdmin, ctrl.resetPassword);

module.exports = router;

export {};
