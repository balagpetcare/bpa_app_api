const router = require("express").Router();
const controller = require("./medicine_requisitions.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

router.use(authenticateToken);

router.post("/", controller.create);
router.get("/", controller.list);
router.get("/summary", controller.summary);
router.get("/search-medicine", controller.searchMedicine);
// Numeric :id only — prevents "summary" / "search-medicine" matching :id and Number(NaN) → 400 Invalid id
router.get("/:id(\\d+)", controller.getById);
router.patch("/:id(\\d+)", controller.updateItems);
router.post("/:id(\\d+)/submit", controller.submit);
router.post("/:id(\\d+)/cancel", controller.cancel);
router.post("/:id(\\d+)/approve", controller.approve);
router.post("/:id(\\d+)/reject", controller.reject);
router.post("/:id(\\d+)/dispatch", controller.dispatch);
router.post("/:id(\\d+)/dispatch-auto", controller.dispatchAuto);
router.post("/:id(\\d+)/receive", controller.receive);

module.exports = router;

export {};
