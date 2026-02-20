const router = require("express").Router();
const controller = require("./catalog_requests.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id", controller.getById);
router.post("/:id/approve", controller.approve);
router.post("/:id/decline", controller.decline);

module.exports = router;
export {};
