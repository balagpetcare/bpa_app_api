const router = require("express").Router();
const controller = require("./pos.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const {
  requirePosPermission,
  requirePosPermissionForOrder,
} = require("./pos.middleware");

// All routes require authentication
router.use(authenticateToken);

// GET /api/v1/pos/products/barcode/:barcode - Barcode lookup (branchId in query)
router.get(
  "/products/barcode/:barcode",
  requirePosPermission("pos.view"),
  controller.getProductByBarcode
);

// GET /api/v1/pos/products - Get products for POS (branchId in query)
router.get(
  "/products",
  requirePosPermission("pos.view"),
  controller.getProducts
);

// POST /api/v1/pos/sale - Create POS sale (branchId in body)
router.post("/sale", requirePosPermission("pos.sell"), controller.createSale);

// POST /api/v1/pos/return - Line-item return (branchId in body)
router.post("/return", requirePosPermission("pos.refund"), controller.createReturn);

// GET /api/v1/pos/receipt/:orderId - Get receipt (branch resolved from order)
router.get(
  "/receipt/:orderId",
  requirePosPermissionForOrder("pos.view"),
  controller.getReceipt
);

// GET /api/v1/pos/invoice/:orderId - Get invoice for print (branch resolved from order)
router.get(
  "/invoice/:orderId",
  requirePosPermissionForOrder("pos.view"),
  controller.getInvoice
);

// --- P3: Cash drawer + shift (branchId in query or body) ---
// GET /api/v1/pos/shift/current?branchId=
router.get(
  "/shift/current",
  requirePosPermission("pos.view"),
  controller.getCurrentShift
);

// POST /api/v1/pos/shift/open (body: branchId, startingCash)
router.post(
  "/shift/open",
  requirePosPermission("cashdrawer.open"),
  controller.openShift
);

// POST /api/v1/pos/shift/close/:id (body: closingCash, managerOverrideReason?)
router.post(
  "/shift/close/:id",
  requirePosPermission("cashdrawer.close"),
  controller.closeShift
);

// GET /api/v1/pos/shift/:id/z-report
router.get(
  "/shift/:id/z-report",
  requirePosPermission("pos.view"),
  controller.getZReport
);

module.exports = router;

export {};
