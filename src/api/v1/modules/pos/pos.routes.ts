const router = require("express").Router();
const controller = require("./pos.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

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

// GET /api/v1/pos/products - Get products for POS
router.get(
  "/products",
  requirePermission("orders.read", "inventory.read"),
  controller.getProducts
);

// POST /api/v1/pos/sale - Create POS sale
router.post(
  "/sale",
  requirePermission("orders.create", "org.write"),
  controller.createSale
);

// GET /api/v1/pos/receipt/:orderId - Get receipt
router.get(
  "/receipt/:orderId",
  requirePermission("orders.read"),
  controller.getReceipt
);

module.exports = router;

export {};
