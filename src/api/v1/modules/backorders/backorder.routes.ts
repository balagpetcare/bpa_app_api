const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./backorder.controller");

const readBackorder = requirePermission("inventory.view", "warehouse.allocation.manage", "warehouse.manage");
const mutateBackorder = requirePermission("warehouse.allocation.manage", "warehouse.manage");

router.use(authenticateToken);

router.get("/", readBackorder, controller.list);
router.get("/:id(\\d+)", readBackorder, controller.getById);
router.patch("/:id(\\d+)", mutateBackorder, controller.update);
router.post("/:id(\\d+)/cancel", mutateBackorder, controller.cancel);

module.exports = router;
export {};
