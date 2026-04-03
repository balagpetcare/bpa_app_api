const router = require("express").Router();
const controller = require("./stock_requests.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/:id", controller.getById);
router.patch("/:id/items/:itemId/cancel", controller.cancelLineHandler);
router.patch("/:id/items/:itemId/restore", controller.restoreLineHandler);
router.post("/:id/allocation-preview", controller.allocationPreviewHandler);
router.patch("/:id/fulfill", controller.fulfill);
router.patch("/:id", controller.updateItems);
router.post("/:id/submit", controller.submit);
router.post("/:id/cancel", controller.cancel);
router.post("/:id/approve", controller.approve);
router.post("/:id/decline", controller.decline);
router.post("/:id/dispatch", controller.dispatch);

module.exports = router;

export {};
