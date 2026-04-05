const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./allocationPlan.controller");

/** Read allocation plans (list + detail) */
const readAllocation = requirePermission(
  "warehouse.view",
  "warehouse.allocation.manage",
  "warehouse.manage"
);
/** Create plans, FEFO, manual lines, confirm, cancel, reallocate */
const mutateAllocation = requirePermission("warehouse.allocation.manage", "warehouse.manage");

router.use(authenticateToken);

router.get("/", readAllocation, controller.list);
router.get("/:id(\\d+)", readAllocation, controller.getById);

router.post("/from-stock-request", mutateAllocation, controller.createFromStockRequest);
router.post("/from-medicine-requisition", mutateAllocation, controller.createFromMedicineRequisition);
router.post("/:id(\\d+)/lines/manual", mutateAllocation, controller.addManualLine);
router.post("/:id(\\d+)/reallocate", mutateAllocation, controller.reallocate);
router.post("/:id(\\d+)/run-fefo", mutateAllocation, controller.runFefo);
router.post("/:id(\\d+)/confirm", mutateAllocation, controller.confirm);
router.post("/:id(\\d+)/cancel", mutateAllocation, controller.cancel);

module.exports = router;
export {};
