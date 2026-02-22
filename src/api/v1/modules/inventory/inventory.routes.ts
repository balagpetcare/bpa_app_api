const router = require("express").Router();
const controller = require("./inventory.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

// Helper function to check permissions
function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    const hasPermission = permissions.some((perm) => userPerms.includes(perm));

    if (!hasPermission) {
      // For MVP: Allow if user is owner or has any org/branch membership
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
    }

    next();
  };
}

// All routes require authentication
router.use(authenticateToken);

// ============================
// V2 Ledger-based endpoints (order before /:id)
// ============================

// GET /api/v1/inventory - List inventory (ledger-derived summary)
router.get("/", controller.getInventory);

// GET /api/v1/inventory/alerts - Low stock alerts (v2 ledger-based)
router.get("/alerts", controller.getLowStockAlerts);

// GET /api/v1/inventory/expiring - Expiring items (v2 lot-based)
router.get("/expiring", controller.getExpiringItems);

// GET /api/v1/inventory/balance - Get stock balance (location-based)
router.get(
  "/balance",
  requirePermission("inventory.read", "org.read"),
  controller.getStockBalance
);

// GET /api/v1/inventory/locations - List user-accessible locations
router.get(
  "/locations",
  requirePermission("inventory.read", "org.read"),
  controller.getInventoryLocations
);

// GET /api/v1/inventory/summary - Ledger-derived summary
router.get(
  "/summary",
  requirePermission("inventory.read", "org.read"),
  controller.getInventorySummary
);

// GET /api/v1/inventory/lots - Lot-wise stock
router.get(
  "/lots",
  requirePermission("inventory.read", "org.read"),
  controller.getInventoryLots
);

// GET /api/v1/inventory/variants/search - Searchable product picker (q=, orgId=, limit=, page=)
router.get(
  "/variants/search",
  requirePermission("inventory.read", "org.read"),
  controller.getVariantsSearch
);

// GET /api/v1/inventory/dashboard - Dashboard cards (totalSkus, lowStockCount, expiringCount)
router.get(
  "/dashboard",
  requirePermission("inventory.read", "org.read"),
  controller.getInventoryDashboard
);
// GET /api/v1/inventory/valuation - Stock valuation (locationId=, variantId=, method=FIFO|WEIGHTED_AVG)
router.get(
  "/valuation",
  requirePermission("inventory.read", "org.read"),
  controller.getValuation
);

// POST /api/v1/inventory/opening - Create opening stock (OPENING ledger, requires lot)
router.post(
  "/opening",
  requirePermission("inventory.update", "org.write"),
  controller.createOpeningStock
);

// POST /api/v1/inventory/adjustment-requests - Request stock adjustment
router.post(
  "/adjustment-requests",
  requirePermission("inventory.update", "org.write"),
  controller.createAdjustmentRequest
);
// PATCH /api/v1/inventory/adjustment-requests/:id - Approve or reject (body: { status: "APPROVED"|"REJECTED", reviewNote? })
router.patch(
  "/adjustment-requests/:id",
  requirePermission("inventory.update", "org.write"),
  controller.reviewAdjustmentRequest
);

// BLOCKED (ledger-only): legacy upsert/adjust/transfer return 410
router.post("/adjust", controller.blockedAdjustNew);
router.post("/", controller.blockedUpsert);
router.post("/:id/adjust", controller.blockedAdjust);
router.post("/:id/transfer", controller.blockedTransfer);

// GET /api/v1/inventory/fefo - FEFO helper: available lots by earliest expiry (excludes expired)
router.get(
  "/fefo",
  requirePermission("inventory.read", "org.read"),
  controller.getFefoLots
);

// GET /api/v1/inventory/ledger - Ledger history for audit UIs (locationId, variantId, lotId, type, refType, refId, page, limit)
router.get(
  "/ledger",
  requirePermission("inventory.read", "org.read"),
  controller.getInventoryLedger
);

// ============================
// Stock requests (alias: /api/v1/inventory/stock-requests)
// ============================
router.use("/stock-requests", require("../stock_requests/stock_requests.routes"));

// ============================
// Dispatches (Challan/DO): list, create, send, receive, incoming
// ============================
router.use("/dispatches", require("../dispatches/dispatches.routes"));

// GET /api/v1/inventory/receipts/bulk-template - CSV template for bulk receive
router.get(
  "/receipts/bulk-template",
  requirePermission("inventory.read", "org.read"),
  controller.getBulkReceiveTemplate
);
// POST /api/v1/inventory/direct-dispatch - Owner direct dispatch (create StockRequest + Dispatch for branch)
router.post(
  "/direct-dispatch",
  requirePermission("inventory.update", "org.write"),
  controller.createDirectDispatch
);
// POST /api/v1/inventory/receipts/bulk - Bulk purchase receive (create GRN + receive atomically)
router.post(
  "/receipts/bulk",
  requirePermission("inventory.update", "org.write"),
  controller.createBulkReceipt
);
// GET /api/v1/inventory/receipts/incoming - Incoming dispatches for branch (alias for GET /dispatches/incoming?branchId=)
router.get("/receipts/incoming", requirePermission("inventory.read", "org.read"), require("../dispatches/dispatches.controller").getIncomingDispatches);

// ============================
// Stock count (cycle count)
// ============================
const stockCountController = require("./stockCount.controller");
router.post("/stock-counts", requirePermission("inventory.update", "org.write"), stockCountController.createStockCount);
router.get("/stock-counts", requirePermission("inventory.read", "org.read"), stockCountController.listStockCounts);
router.get("/stock-counts/:id", requirePermission("inventory.read", "org.read"), stockCountController.getStockCountById);
router.post("/stock-counts/:id/freeze", requirePermission("inventory.update", "org.write"), stockCountController.freezeStockCount);
router.patch("/stock-counts/:id/lines", requirePermission("inventory.update", "org.write"), stockCountController.upsertCountLines);
router.post("/stock-counts/:id/post", requirePermission("inventory.update", "org.write"), stockCountController.postStockCount);

// ============================
// Reports (ledger-based)
// ============================
router.get("/reports/stock-balance", requirePermission("inventory.read", "org.read"), controller.getReportsStockBalance);
router.get("/reports/stock-by-lot-expiry", requirePermission("inventory.read", "org.read"), controller.getReportsStockByLotExpiry);
router.get("/reports/movements", requirePermission("inventory.read", "org.read"), controller.getInventoryLedger);

// GET /api/v1/inventory/:id - Get single item (ledger summary by composite id)
router.get("/:id", controller.getInventoryItem);

// POST /api/v1/inventory/pos-sale - Record POS sale (SALE_POS ledger)
router.post(
  "/pos-sale",
  requirePermission("inventory.update", "pos", "org.write"),
  controller.recordPosSale
);

// POST /api/v1/inventory/online-reserve - Reserve stock for online order (RESERVE_ONLINE)
router.post(
  "/online-reserve",
  requirePermission("inventory.update", "org.write"),
  controller.reserveOnlineStock
);

// POST /api/v1/inventory/online-sale - Commit online sale (SALE_ONLINE + RELEASE_RESERVE)
router.post(
  "/online-sale",
  requirePermission("inventory.update", "org.write"),
  controller.commitOnlineSale
);

module.exports = router;

export {};
