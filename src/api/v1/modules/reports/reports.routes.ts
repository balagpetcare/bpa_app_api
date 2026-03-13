const router = require("express").Router();
const controller = require("./reports.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");

// All routes require authentication + reports.read or reports.view (branch staff) permission
router.use(authenticateToken);
router.use(requirePermission("reports.read", "reports.view", "org.read", "branches.read"));

// GET /api/v1/reports/sales - Sales report
router.get("/sales", controller.getSalesReport);

// GET /api/v1/reports/top-products - Top selling products
router.get("/top-products", controller.getTopSellingProducts);

// GET /api/v1/reports/zero-sales - Zero sales products
router.get("/zero-sales", controller.getZeroSalesProducts);

// GET /api/v1/reports/stock - Stock report
router.get("/stock", controller.getStockReport);

// GET /api/v1/reports/revenue - Revenue analytics
router.get("/revenue", controller.getRevenueAnalytics);

module.exports = router;

export {};
