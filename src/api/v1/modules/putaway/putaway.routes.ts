const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const controller = require("./putaway.controller");

router.use(authenticateToken);
router.use(requirePermission("warehouse.operations", "warehouse.view", "warehouse.manage"));

router.get("/recommendations", controller.recommendations);
router.get("/tasks", controller.listTasks);
router.post("/tasks/:id(\\d+)/confirm", controller.confirm);

module.exports = router;
export {};
