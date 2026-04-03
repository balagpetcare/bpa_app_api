const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_medicine_catalog.controller");

router.get("/search", authenticateToken, requireAdmin, ctrl.search);
router.get("/brands/:id", authenticateToken, requireAdmin, ctrl.getBrand);

module.exports = router;
export {};
