const router = require("express").Router();
const controller = require("./vendors.controller");
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

// POST /api/v1/vendors - Create vendor
router.post("/", requirePermission("org.write"), controller.createVendor);

// POST /api/v1/vendors/:id/listings - Create vendor listing (draft)
router.post("/:id/listings", requirePermission("org.write"), controller.createVendorListing);

// POST /api/v1/vendors/listings/:id/approve - Approve vendor listing (admin)
router.post("/listings/:id/approve", requirePermission("admin.vendor"), controller.approveVendorListing);

// GET /api/v1/vendors/listings - Get vendor listings
router.get("/listings", requirePermission("org.read"), controller.getVendorListings);

// POST /api/v1/commission-rules - Create commission rule
router.post("/commission-rules", requirePermission("org.write"), controller.createCommissionRule);

module.exports = router;

export {};
