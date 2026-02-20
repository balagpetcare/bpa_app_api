const router = require("express").Router();
const controller = require("./dispatches.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.get("/", controller.listDispatches);
router.get("/incoming", controller.getIncomingDispatches);
router.post("/", controller.createDispatch);
router.get("/:id", controller.getDispatch);
router.post("/:id/status", controller.updateStatus);
router.post("/:id/send", controller.sendDispatch);
router.post("/:id/receive", controller.receiveDispatch);

module.exports = router;

export {};
