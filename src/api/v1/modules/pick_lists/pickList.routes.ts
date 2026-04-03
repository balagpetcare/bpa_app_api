const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./pickList.controller");

router.use(authenticateToken);

router.get("/", controller.list);
router.get("/:id(\\d+)", controller.getById);
router.post("/from-plan/:planId(\\d+)", controller.createFromPlan);
router.post("/:id(\\d+)/assign-picker", controller.assignPicker);
router.post("/:id(\\d+)/start", controller.start);
router.patch("/:id(\\d+)/lines/:lineId(\\d+)", controller.updateLine);
router.post("/:id(\\d+)/complete", controller.complete);
router.post("/:id(\\d+)/handoff-dispatch", controller.handoff);

module.exports = router;
export {};
