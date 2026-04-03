const router = require("express").Router();
const controller = require("./fulfillment.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.post("/stock-requests/:id(\\d+)/start", controller.startFromStockRequest);
router.get("/stock-requests/:id(\\d+)/status", controller.getStockRequestStatus);

module.exports = router;
export {};
