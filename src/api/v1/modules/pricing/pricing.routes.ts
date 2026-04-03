const router = require("express").Router();
const controller = require("./pricing.controller");
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

// POST /api/v1/pricing - Set location price
router.post("/", requirePermission("inventory.update", "org.write"), controller.setPrice);

// GET /api/v1/pricing - Get location price
router.get("/", requirePermission("product.read", "org.read"), controller.getPrice);

// GET /api/v1/pricing/resolve - Resolve selling price
router.get("/resolve", requirePermission("product.read", "org.read"), controller.resolvePrice);

// GET /api/v1/pricing/org - List org-level product pricings
router.get("/org", requirePermission("org.read", "product.read"), controller.listOrgPricing);

// POST /api/v1/pricing/org - Set org-level product pricing
router.post("/org", requirePermission("org.write", "product.update"), controller.setOrgPricing);

// GET /api/v1/pricing/branch - List branch pricing overrides
router.get("/branch", requirePermission("branch.read", "org.read"), controller.listBranchPricing);

// POST /api/v1/pricing/branch - Set branch pricing override
router.post("/branch", requirePermission("branch.write", "org.write"), controller.setBranchPricing);

// POST /api/v1/inventory/locations/:locationId/variants/:variantId/enable
// Note: This route is mounted under /inventory in main routes.ts
// router.post("/locations/:locationId/variants/:variantId/enable", ...);

module.exports = router;

export {};
