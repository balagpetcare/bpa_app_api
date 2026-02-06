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
