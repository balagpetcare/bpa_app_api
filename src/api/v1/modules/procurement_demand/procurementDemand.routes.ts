const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./procurementDemand.controller");

router.use(authenticateToken);

/** Static path before `/:id` so future non-numeric segments never collide. */
router.post(
  "/process-grn/:grnId(\\d+)",
  requirePermission("inbound.grn", "grn.post", "purchase.receive", "procurement.demand.manage"),
  controller.processGrn
);

router.get(
  "/",
  requirePermission(
    "procurement.demand.view",
    "procurement.demand.manage",
    "procurement.po.manage",
    "warehouse.manage",
    "warehouse.view"
  ),
  controller.list
);
router.get(
  "/:id(\\d+)",
  requirePermission(
    "procurement.demand.view",
    "procurement.demand.manage",
    "procurement.po.manage",
    "warehouse.manage",
    "warehouse.view"
  ),
  controller.getById
);

router.post(
  "/:id(\\d+)/link-po-line",
  requirePermission("procurement.demand.manage", "procurement.demand.link_po", "procurement.po.manage"),
  controller.linkPoLine
);

router.post(
  "/:id(\\d+)/cancel",
  requirePermission("procurement.demand.manage", "procurement.po.manage"),
  controller.cancel
);

module.exports = router;
export {};
