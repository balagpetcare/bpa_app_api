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

// GET /api/v1/pos/membership/card?branchId=&code=
router.get(
  "/membership/card",
  requirePosPermission("pos.view"),
  controller.getMembershipCardForPos
);

// GET /api/v1/pos/membership/resolve?branchId=&code=&customerUserId=&phone=
router.get(
  "/membership/resolve",
  requirePosPermission("pos.view"),
  controller.resolveMembershipForPos
);

// GET /api/v1/pos/customers/lookup?branchId=&q=
router.get(
  "/customers/lookup",
  requirePosPermission("pos.view"),
  controller.lookupPosCustomer
);

// POST /api/v1/pos/customers/ensure
router.post(
  "/customers/ensure",
  requirePosPermission("pos.sell"),
  controller.ensurePosCustomer
);

// --- Server-side POS carts (multi-cart) — branchId in query or body ---
router.get("/carts", requirePosPermission("pos.view"), controller.listPosCarts);
router.post("/carts", requirePosPermission("pos.sell"), controller.createPosCart);
router.get("/carts/:cartId", requirePosPermission("pos.view"), controller.getPosCart);
router.patch("/carts/:cartId", requirePosPermission("pos.sell"), controller.patchPosCart);
router.post("/carts/:cartId/lines", requirePosPermission("pos.sell"), controller.addPosCartLine);
router.patch("/carts/:cartId/lines/:lineId", requirePosPermission("pos.sell"), controller.patchPosCartLine);
router.delete("/carts/:cartId/lines/:lineId", requirePosPermission("pos.sell"), controller.deletePosCartLine);
router.post("/carts/:cartId/hold", requirePosPermission("pos.sell"), controller.holdPosCart);
router.post("/carts/:cartId/resume", requirePosPermission("pos.sell"), controller.resumePosCart);
router.post("/carts/:cartId/preview", requirePosPermission("pos.view"), controller.previewPosCart);
router.post("/carts/:cartId/finalize", requirePosPermission("pos.sell"), controller.finalizePosCart);
router.delete("/carts/:cartId", requirePosPermission("pos.sell"), controller.abandonPosCart);

// POST /api/v1/pos/sale - Create POS sale (branchId in body)
router.post("/sale", requirePosPermission("pos.sell"), controller.createSale);

// POST /api/v1/pos/orders/:orderId/cancel — POS refund permission (branch resolved from order)
router.post(
  "/orders/:orderId/cancel",
  requirePosPermissionForOrder("pos.refund"),
  controller.cancelPosOrder
);

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
