const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./allocationPlan.controller");

router.use(authenticateToken);

router.post("/from-stock-request", controller.createFromStockRequest);
router.post("/from-medicine-requisition", controller.createFromMedicineRequisition);
router.get("/", controller.list);
router.get("/:id(\\d+)", controller.getById);
router.post("/:id(\\d+)/run-fefo", controller.runFefo);
router.post("/:id(\\d+)/confirm", controller.confirm);
router.post("/:id(\\d+)/cancel", controller.cancel);

module.exports = router;
export {};
