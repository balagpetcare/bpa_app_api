const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./qcInspection.controller");

router.use(authenticateToken);

router.get("/", controller.listQueue);
router.get("/quarantine", controller.listQuarantine);
router.get("/escalations", controller.listEscalations);
router.get("/:id(\\d+)", controller.getById);
router.post("/:id(\\d+)/submit", controller.submit);
router.post("/:id(\\d+)/quarantine/release", controller.release);
router.post("/:id(\\d+)/quarantine/dispose", controller.dispose);

module.exports = router;
export {};
