const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_staff.controller");

// GET /api/v1/admin/staff?q=...&orgId=...&branchId=...&role=...&status=...
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// GET /api/v1/admin/staff/:id
router.get("/:id", authenticateToken, requireAdmin, ctrl.getById);

// POST /api/v1/admin/staff
router.post("/", authenticateToken, requireAdmin, ctrl.create);

// PATCH /api/v1/admin/staff/:id  (role/status/branchId)
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

// POST /api/v1/admin/staff/:id/roles
router.post("/:id/roles", authenticateToken, requireAdmin, ctrl.assignRole);

// POST /api/v1/admin/staff/:id/branches
router.post("/:id/branches", authenticateToken, requireAdmin, ctrl.assignBranch);

module.exports = router;

export {};
