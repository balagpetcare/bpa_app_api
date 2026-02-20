const router = require("express").Router();
const controller = require("./online-store.controller");
// Note: Online store can be public or require auth - adjust as needed
// const authenticateToken = require("../../../../middleware/auth.middleware");
// router.use(authenticateToken);

// GET /api/v1/online-store/products - Get products (ONLINE_HUB aggregation)
router.get("/products", controller.getProducts);

// GET /api/v1/online-store/variants/:id/availability - Get variant availability per hub
router.get("/variants/:id/availability", controller.getVariantAvailability);

// POST /api/v1/online-store/checkout/choose-hub - Choose hub with stock
router.post("/checkout/choose-hub", controller.chooseHub);

module.exports = router;

export {};
