const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_organizations.controller");

// Organizations CRUD (admin)

// List
// GET /api/v1/admin/organizations?status=&q=&ownerUserId=
router.get("/", authenticateToken, requireAdmin, ctrl.list);

// Create (optional)
// POST /api/v1/admin/organizations
router.post("/", authenticateToken, requireAdmin, ctrl.create);

// Read
// GET /api/v1/admin/organizations/:id
router.get("/:id", authenticateToken, requireAdmin, ctrl.getById);

// Update (PATCH keeps UI simple)
// PATCH /api/v1/admin/organizations/:id
router.patch("/:id", authenticateToken, requireAdmin, ctrl.updateById);

module.exports = router;

export {};
