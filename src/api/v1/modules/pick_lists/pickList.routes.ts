const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./pickList.controller");

const readPick = requirePermission("warehouse.view", "warehouse.pick.execute", "warehouse.manage");
const mutatePick = requirePermission("warehouse.pick.execute", "warehouse.manage");

router.use(authenticateToken);

router.get("/", readPick, controller.list);
router.get("/:id(\\d+)", readPick, controller.getById);
router.post("/from-plan/:planId(\\d+)", mutatePick, controller.createFromPlan);
router.post("/:id(\\d+)/assign-picker", mutatePick, controller.assignPicker);
router.post("/:id(\\d+)/start", mutatePick, controller.start);
router.patch("/:id(\\d+)/lines/:lineId(\\d+)", mutatePick, controller.updateLine);
router.post("/:id(\\d+)/complete", mutatePick, controller.complete);
router.post("/:id(\\d+)/handoff-dispatch", mutatePick, controller.handoff);
router.get("/:id(\\d+)/print", readPick, controller.printHtml);

module.exports = router;
export {};
