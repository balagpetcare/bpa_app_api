const router = require("express").Router();
const controller = require("./transfers.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

/**
 * @deprecated LEGACY STOCK TRANSFER ROUTES
 *
 * These routes are deprecated. Use StockDispatch flow instead:
 *   - POST /api/v1/inventory/dispatches (create dispatch)
 *   - POST /api/v1/inventory/dispatches/:id/send (send/transit)
 *   - POST /api/v1/inventory/dispatches/:id/receive (receive with controlled session)
 *
 * See: docs/VENDOR_RECEIVE_BRANCH_CONFIRMATION_PRICING_GOVERNANCE_PLAN.md
 */

// Middleware to log deprecation warning on every request
router.use((req: any, res: any, next: any) => {
  console.warn(`[DEPRECATED] StockTransfer API called: ${req.method} ${req.originalUrl}. Use StockDispatch flow instead.`);
  next();
});

// Helper function to check permissions
function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    const hasPermission = permissions.some((perm) => userPerms.includes(perm));

    if (!hasPermission) {
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

// GET /api/v1/transfers - List transfers
router.get("/", requirePermission("inventory.read", "org.read"), controller.getTransfers);

// GET /api/v1/transfers/:id - Get single transfer
router.get("/:id", requirePermission("inventory.read", "org.read"), controller.getTransfer);

// POST /api/v1/transfers - Create transfer (draft)
router.post(
  "/",
  requirePermission("inventory.update", "org.write"),
  controller.createTransfer
);

// POST /api/v1/transfers/:id/send - Send transfer (TRANSFER_OUT)
router.post(
  "/:id/send",
  requirePermission("inventory.update", "org.write"),
  controller.sendTransfer
);

// POST /api/v1/transfers/:id/receive - Receive transfer (TRANSFER_IN + optional DAMAGE/EXPIRED)
router.post(
  "/:id/receive",
  requirePermission("inventory.update", "org.write", "inventory.receive"),
  controller.receiveTransfer
);

// POST /api/v1/transfers/:id/resolve-dispute - Owner: Resolve disputed transfer
router.post(
  "/:id/resolve-dispute",
  requirePermission("inventory.update", "org.write"),
  controller.resolveDispute
);

module.exports = router;

export {};
