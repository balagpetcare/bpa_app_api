const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_branch_types.controller");

// GET /api/v1/admin/branch-types
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// POST /api/v1/admin/branch-types  (upsert by code)
router.post("/", authenticateToken, requireAdmin, ctrl.upsert);

// PATCH /api/v1/admin/branch-types/:id  (update fields / toggle isActive)
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

module.exports = router;

export {};
