const router = require("express").Router();
const controller = require("./orders.controller");
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

// GET /api/v1/orders - List orders
router.get("/", controller.getOrders);

// GET /api/v1/orders/:id - Get single order
router.get("/:id", controller.getOrder);

// POST /api/v1/orders - Create order
router.post(
  "/",
  requirePermission("order.create", "org.write"),
  controller.createOrder
);

// PATCH /api/v1/orders/:id/status - Update order status
router.patch(
  "/:id/status",
  requirePermission("order.update", "org.write"),
  controller.updateOrderStatus
);

// POST /api/v1/orders/:id/payment - Process payment
router.post(
  "/:id/payment",
  requirePermission("order.update", "org.write"),
  controller.processPayment
);

// POST /api/v1/orders/:id/cancel - Cancel order (POS cashiers: pos.refund; staff: order.update / org.write)
router.post(
  "/:id/cancel",
  requirePermission("order.update", "org.write", "pos.refund"),
  controller.cancelOrder
);

module.exports = router;

export {};
