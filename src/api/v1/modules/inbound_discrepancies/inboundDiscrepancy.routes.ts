const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const controller = require("./inboundDiscrepancy.controller");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.post("/:id(\\d+)/resolve", controller.resolve);

module.exports = router;
export {};
