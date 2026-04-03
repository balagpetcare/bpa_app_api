const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./inboundShipment.controller");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id(\\d+)", controller.getById);
router.patch("/:id(\\d+)", controller.patch);

module.exports = router;
export {};
