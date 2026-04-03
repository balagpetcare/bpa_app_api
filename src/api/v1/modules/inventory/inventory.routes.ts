const router = require("express").Router();
const controller = require("./inventory.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const { inventoryWarehouseMutationLimiter } = require("../../../../middleware/rateLimiters");

// Helper function to check permissions - MVP bypass removed, now enforces 403
function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    const hasPermission = permissions.some((perm) => userPerms.includes(perm));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "Permission denied",
        code: "MISSING_PERMISSION",
        requiredPermissions: permissions,
      });
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

// GET /api/v1/inventory/batches — enriched batch rows (alias with flat DTO + summary); does not replace /lots
router.get(
  "/batches",
  requirePermission("inventory.read", "org.read"),
  controller.getInventoryBatches
);

// GET /api/v1/inventory/variants/search - Product picker: q=, orgId=, limit=, page=, categoryId=, brandId=, variantActive=all|active
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
// Pharmacy Enterprise: Expiry Write-Off
// ============================
const expiryWriteOffController = require("./expiryWriteOff.controller");
router.post(
  "/expiry-writeoff/scan",
  requirePermission("inventory.update", "org.write"),
  expiryWriteOffController.scanAndWriteOff
);
router.post(
  "/expiry-writeoff/manual",
  requirePermission("inventory.update", "org.write"),
  expiryWriteOffController.manualWriteOff
);
router.get(
  "/expiry-writeoff/log",
  requirePermission("inventory.read", "org.read"),
  expiryWriteOffController.getWriteOffLog
);
router.get(
  "/expired-stock",
  requirePermission("inventory.read", "org.read"),
  expiryWriteOffController.getExpiredStock
);

// ============================
// Pharmacy Enterprise: Batch Recall
// ============================
const batchRecallController = require("./batchRecall.controller");
const recallCampaignController = require("./recallCampaign.controller");
const quarantineStockController = require("./quarantineStock.controller");

router.get(
  "/quarantine-stock",
  requirePermission("inventory.read", "org.read"),
  quarantineStockController.listQuarantineStock
);

router.post(
  "/recalls/campaigns",
  requirePermission("inventory.update", "org.write"),
  recallCampaignController.postCampaign
);
router.get(
  "/recalls/campaigns",
  requirePermission("inventory.read", "org.read"),
  recallCampaignController.getCampaigns
);
router.get(
  "/recalls/campaigns/:id",
  requirePermission("inventory.read", "org.read"),
  recallCampaignController.getCampaign
);
router.post(
  "/recalls/campaigns/:id/attach-recall",
  requirePermission("inventory.update", "org.write"),
  recallCampaignController.postAttachRecall
);

router.post(
  "/recalls",
  requirePermission("inventory.update", "org.write"),
  batchRecallController.createRecall
);
router.get(
  "/recalls",
  requirePermission("inventory.read", "org.read"),
  batchRecallController.listRecalls
);
router.get(
  "/recalls/:id",
  requirePermission("inventory.read", "org.read"),
  batchRecallController.getRecallDetail
);
router.post(
  "/recalls/:id/quarantine",
  requirePermission("inventory.update", "org.write"),
  batchRecallController.quarantineLot
);
router.post(
  "/recalls/:id/resolve",
  requirePermission("inventory.update", "org.write"),
  batchRecallController.resolveRecall
);
router.post(
  "/recalls/:id/cancel",
  requirePermission("inventory.update", "org.write"),
  batchRecallController.cancelRecall
);
router.post(
  "/recalls/:id/release-allocation",
  requirePermission("inventory.update", "org.write"),
  batchRecallController.releaseAllocation
);

// ============================
// Write-Off Requests (General Purpose)
// ============================
const writeOffRequestController = require("./writeOffRequest.controller");
router.post(
  "/write-off-requests",
  requirePermission("inventory.writeoff.request", "inventory.update", "org.write"),
  writeOffRequestController.createWriteOffRequest
);
router.get(
  "/write-off-requests",
  requirePermission("inventory.read", "org.read"),
  writeOffRequestController.listWriteOffRequests
);
router.get(
  "/write-off-requests/auto-approve-thresholds",
  requirePermission("inventory.read", "org.read"),
  writeOffRequestController.getAutoApproveThresholds
);
router.get(
  "/write-off-requests/:id",
  requirePermission("inventory.read", "org.read"),
  writeOffRequestController.getWriteOffRequest
);
router.post(
  "/write-off-requests/:id/approve",
  requirePermission("inventory.writeoff.approve", "inventory.update", "org.write"),
  writeOffRequestController.approveWriteOffRequest
);
router.post(
  "/write-off-requests/:id/reject",
  requirePermission("inventory.writeoff.approve", "inventory.update", "org.write"),
  writeOffRequestController.rejectWriteOffRequest
);
router.post(
  "/write-off-requests/:id/post",
  requirePermission("inventory.writeoff.approve", "inventory.update", "org.write"),
  writeOffRequestController.postWriteOffRequest
);

// ============================
// Vendor Returns (Phase 3)
// ============================
const vendorReturnController = require("./vendorReturn.controller");
router.post(
  "/vendor-returns",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.createVendorReturn
);
router.get(
  "/vendor-returns",
  requirePermission("inventory.read", "org.read"),
  vendorReturnController.listVendorReturns
);
router.get(
  "/vendor-returns/:id",
  requirePermission("inventory.read", "org.read"),
  vendorReturnController.getVendorReturn
);
router.post(
  "/vendor-returns/:id/submit",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.submitVendorReturn
);
router.post(
  "/vendor-returns/:id/approve",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.approveVendorReturn
);
router.post(
  "/vendor-returns/:id/dispatch",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.dispatchVendorReturn
);
router.post(
  "/vendor-returns/:id/received-by-vendor",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.markReceivedByVendor
);
router.post(
  "/vendor-returns/:id/credit",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.markCredited
);
router.post(
  "/vendor-returns/:id/cancel",
  requirePermission("inventory.update", "org.write"),
  vendorReturnController.cancelVendorReturn
);

// ============================
// Warehouse Transfer Orders (Phase 5)
// ============================
const wtoController = require("./warehouseTransferOrder.controller");
router.post(
  "/warehouse-transfer-orders",
  requirePermission("inventory.update", "org.write"),
  wtoController.createWTO
);
router.get(
  "/warehouse-transfer-orders",
  requirePermission("inventory.read", "org.read"),
  wtoController.listWTO
);
router.get(
  "/warehouse-transfer-orders/:id",
  requirePermission("inventory.read", "org.read"),
  wtoController.getWTO
);
router.post(
  "/warehouse-transfer-orders/:id/approve",
  requirePermission("inventory.update", "org.write"),
  wtoController.approveWTO
);
router.post(
  "/warehouse-transfer-orders/:id/pick",
  requirePermission("inventory.update", "org.write"),
  wtoController.pickWTO
);
router.post(
  "/warehouse-transfer-orders/:id/dispatch",
  requirePermission("inventory.update", "org.write"),
  wtoController.dispatchWTO
);
router.post(
  "/warehouse-transfer-orders/:id/receive",
  requirePermission("inventory.update", "org.write"),
  wtoController.receiveWTO
);
router.post(
  "/warehouse-transfer-orders/:id/close",
  requirePermission("inventory.update", "org.write"),
  wtoController.closeWTO
);

// ============================
// Pharmacy Enterprise: Dashboard
// ============================
const pharmacyDashboardController = require("./pharmacyDashboard.controller");
router.get(
  "/pharmacy-dashboard",
  requirePermission("inventory.read", "org.read"),
  pharmacyDashboardController.getPharmacyDashboard
);
router.get(
  "/pharmacy-dashboard/trend",
  requirePermission("inventory.read", "org.read"),
  pharmacyDashboardController.getExpiryTrend
);
router.get(
  "/pharmacy-dashboard/alerts",
  requirePermission("inventory.read", "org.read"),
  pharmacyDashboardController.getPharmacyAlerts
);

// ============================
// Phase 4: Inventory Analytics
// ============================
const analyticsController = require("./inventoryAnalytics.controller");
router.get(
  "/analytics/movement-summary",
  requirePermission("inventory.read", "org.read"),
  analyticsController.getMovementSummary
);
router.get(
  "/analytics/stock-turnover",
  requirePermission("inventory.read", "org.read"),
  analyticsController.getStockTurnoverReport
);
router.get(
  "/analytics/abc-analysis",
  requirePermission("inventory.read", "org.read"),
  analyticsController.getAbcAnalysis
);
router.get(
  "/analytics/dead-stock",
  requirePermission("inventory.read", "org.read"),
  analyticsController.getDeadStock
);

// ============================
// Phase 6: Reconciliation
// ============================
router.get(
  "/reconciliation",
  requirePermission("inventory.read", "org.read"),
  analyticsController.reconcileStockBalances
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
// GET /api/v1/inventory/receipts/incoming-unified - Dispatches + in-transit transfers for Receive Center
router.get(
  "/receipts/incoming-unified",
  requirePermission("inventory.read", "org.read"),
  require("../dispatches/dispatches.controller").getIncomingInboundUnified
);

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

// GET /api/v1/inventory/stock-request-products - Product picker for stock request create (with batch/expiry insight)
router.get(
  "/stock-request-products",
  requirePermission("inventory.read", "org.read"),
  controller.getStockRequestProducts
);

// GET /api/v1/inventory/stock-request-extra-picker - Owner fulfill extra items (location-scoped, FEFO-aligned)
router.get(
  "/stock-request-extra-picker",
  requirePermission("inventory.read", "org.read"),
  controller.getStockRequestExtraPicker
);

// ============================
// Warehouse Phase 1 (enterprise aliases — must be before /:id)
// ============================
router.get(
  "/warehouses",
  requirePermission("inventory.read", "org.read"),
  controller.listWarehouses
);
router.get(
  "/stock",
  requirePermission("inventory.read", "org.read"),
  controller.getWarehouseStock
);
router.post(
  "/stock/in",
  inventoryWarehouseMutationLimiter,
  requirePermission("inventory.update", "org.write"),
  controller.postStockIn
);
router.post(
  "/stock/out",
  inventoryWarehouseMutationLimiter,
  requirePermission("inventory.update", "org.write"),
  controller.postStockOut
);
router.post(
  "/transfers",
  inventoryWarehouseMutationLimiter,
  requirePermission("inventory.update", "org.write"),
  controller.createInventoryTransfer
);
router.post(
  "/transfers/:id/dispatch",
  inventoryWarehouseMutationLimiter,
  requirePermission("inventory.update", "org.write"),
  controller.dispatchInventoryTransfer
);

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
