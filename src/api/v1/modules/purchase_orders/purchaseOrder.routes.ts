const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./purchaseOrder.controller");

router.use(authenticateToken);

router.get("/", requirePermission("procurement.po.view", "procurement.po.manage"), controller.list);
router.get("/:id(\\d+)", requirePermission("procurement.po.view", "procurement.po.manage"), controller.getById);

router.post("/", requirePermission("procurement.po.manage"), controller.create);
router.post("/:id(\\d+)/submit", requirePermission("procurement.po.manage"), controller.submit);
router.post("/:id(\\d+)/approve", requirePermission("procurement.po.manage"), controller.approve);
router.post("/:id(\\d+)/reject", requirePermission("procurement.po.manage"), controller.reject);
router.post("/:id(\\d+)/cancel", requirePermission("procurement.po.manage"), controller.cancel);

module.exports = router;
export {};
