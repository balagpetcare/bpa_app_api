const router = require("express").Router();
const controller = require("./returns.controller");
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

// GET /api/v1/returns - List returns
router.get("/", requirePermission("inventory.read", "orders.read"), controller.getReturns);

// GET /api/v1/returns/:id - Get single return
router.get("/:id", requirePermission("inventory.read", "orders.read"), controller.getReturn);

// POST /api/v1/returns - Create return request
router.post(
  "/",
  requirePermission("inventory.update", "orders.update"),
  controller.createReturn
);

// POST /api/v1/returns/:id/approve - Approve return request
router.post(
  "/:id/approve",
  requirePermission("inventory.update", "orders.update"),
  controller.approveReturn
);

// POST /api/v1/returns/:id/receive - Receive return (RETURN_IN / DAMAGE / EXPIRED)
router.post(
  "/:id/receive",
  requirePermission("inventory.update", "orders.update"),
  controller.receiveReturn
);

module.exports = router;

export {};
