const router = require("express").Router();
const controller = require("./fulfillment.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");

const readFulfillment = requirePermission("warehouse.view", "warehouse.allocation.manage", "warehouse.manage");
const startFulfillment = requirePermission("warehouse.allocation.manage", "warehouse.manage");

router.use(authenticateToken);

router.post("/stock-requests/:id(\\d+)/start", startFulfillment, controller.startFromStockRequest);
router.get("/stock-requests/:id(\\d+)/status", readFulfillment, controller.getStockRequestStatus);

module.exports = router;
export {};
