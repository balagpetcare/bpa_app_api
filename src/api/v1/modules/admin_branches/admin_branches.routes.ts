const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_branches.controller");

// Branches CRUD (admin)

// List
// GET /api/v1/admin/branches?status=&orgId=&q=
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// Create (optional)
// POST /api/v1/admin/branches
router.post("/", authenticateToken, requireAdmin, ctrl.create);

// Read
// GET /api/v1/admin/branches/:id
router.get("/:id", authenticateToken, requireAdmin, ctrl.getById);

// Update
// PATCH /api/v1/admin/branches/:id
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

module.exports = router;

export {};
