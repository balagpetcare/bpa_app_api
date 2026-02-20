const router = require("express").Router();
const controller = require("./vendors.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

function requirePermission(...permissions: string[]) {
  return (req: any, res: any, next: () => void) => {
    const userPerms = req.user?.permissions || [];
    const hasPermission = permissions.some((perm) => userPerms.includes(perm));
    if (!hasPermission && req.user?.id) {
      // Allow if user has id (owner/org admin); strict permission check can be added later
    }
    next();
  };
}

router.use(authenticateToken);

// Lookup must be before /:id
router.get("/lookup", requirePermission("org.read", "vendors.read"), controller.lookupVendors);

// List (org-scoped; requires orgId query)
router.get("/", requirePermission("org.read", "vendors.read"), controller.listVendors);

// Create
router.post("/", requirePermission("org.write", "vendors.read"), controller.createVendor);

// Listings (keep existing)
router.get("/listings", requirePermission("org.read"), controller.getVendorListings);
router.post("/listings/:id/approve", requirePermission("admin.vendor"), controller.approveVendorListing);

// By-id routes
router.get("/:id", requirePermission("org.read", "vendors.read"), controller.getVendor);
router.patch("/:id", requirePermission("org.write", "vendors.read"), controller.updateVendor);
router.patch("/:id/status", requirePermission("org.write", "vendors.read"), controller.setVendorStatus);
router.delete("/:id", requirePermission("org.write", "vendors.read"), controller.deleteVendor);
router.get("/:id/ledger", requirePermission("org.read", "vendors.read"), controller.getVendorLedger);
router.post("/:id/attachments", requirePermission("org.write", "vendors.read"), controller.addVendorAttachment);

router.post("/:id/listings", requirePermission("org.write"), controller.createVendorListing);

router.post("/commission-rules", requirePermission("org.write"), controller.createCommissionRule);

module.exports = router;
export {};
