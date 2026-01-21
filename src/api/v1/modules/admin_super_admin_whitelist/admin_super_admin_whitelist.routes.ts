const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_super_admin_whitelist.controller");

// GET /api/v1/admin/super-admin-whitelist
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// POST /api/v1/admin/super-admin-whitelist
router.post("/", authenticateToken, requireAdmin, ctrl.create);

// PATCH /api/v1/admin/super-admin-whitelist/:id
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

// DELETE /api/v1/admin/super-admin-whitelist/:id
router.delete("/:id", authenticateToken, requireAdmin, ctrl.removeById);

module.exports = router;

export {};
