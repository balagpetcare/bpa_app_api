const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./purchaseRequisition.controller");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id(\\d+)", controller.getById);
router.post("/:id(\\d+)/submit", controller.submit);
router.post("/:id(\\d+)/approve", controller.approve);
router.post("/:id(\\d+)/reject", controller.reject);
router.post("/:id(\\d+)/convert-to-po", controller.convertToPo);

module.exports = router;
export {};
