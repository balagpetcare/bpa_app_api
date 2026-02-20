const router = require("express").Router();
const multer = require("multer");
const controller = require("./products.controller");
const masterCatalogController = require("./master-catalog.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireOwnerKycVerified = require("../../../../middlewares/requireOwnerKycVerified");
const appConfig = require("../../../../config/appConfig");

// Public: product verify display (authenticity MVP)
router.get("/:id/public", controller.getPublicProduct);

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

// Owner or staff with product scope: OWNER role or owner.products.manage / product.update permission
function requireOwnerOrProductManage(...mutatePerms) {
  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const userType = req.user?.userType;
    const role = req.user?.role;
    const userPerms = req.user?.permissions || [];
    const isOwner = userType === "OWNER" || role === "OWNER";
    const hasManage = userPerms.includes("owner.products.manage") ||
      userPerms.includes("product.update") ||
      mutatePerms.some((p) => userPerms.includes(p));
    if (isOwner || hasManage) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Access denied",
      code: "ACCESS_DENIED",
      detail: "Product mutations require OWNER role or product.update/owner.products.manage permission",
      debug: { required: "product.update or owner.products.manage", role: role || userType || "unknown" },
    });
  };
}

// All routes require authentication
router.use(authenticateToken);

// GET /api/v1/products/versions - list versions
router.get("/versions", controller.listProductVersions);

// Multer instance for CSV uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(
      (appConfig.mediaPolicy && appConfig.mediaPolicy.maxUploadBytes) ||
        process.env.MAX_UPLOAD_BYTES ||
        20 * 1024 * 1024,
    ), // default 20MB for CSV
  },
});

// ============================
// MASTER PRODUCT CATALOG ROUTES (must be before /:id routes)
// ============================

// GET /api/v1/products/master-catalog/csv-template - Download CSV template
router.get(
  "/master-catalog/csv-template",
  requirePermission("admin.product.approve", "product.create"),
  masterCatalogController.getMasterCatalogCsvTemplate,
);

// GET /api/v1/products/master-catalog/bd-sample - Download BD pet products sample CSV
router.get(
  "/master-catalog/bd-sample",
  requirePermission("admin.product.approve", "product.create"),
  masterCatalogController.getBdPetSampleCsv,
);

// GET /api/v1/products/master-catalog - Browse/search master catalog
router.get("/master-catalog", masterCatalogController.getMasterCatalog);

// GET /api/v1/products/master-catalog/:id - Get single master product
router.get("/master-catalog/:id", masterCatalogController.getMasterProduct);

// PATCH /api/v1/products/master-catalog/:id - Update master product (admin/content)
router.patch(
  "/master-catalog/:id",
  requirePermission("admin.product.approve", "product.update"),
  masterCatalogController.updateMasterProduct,
);

// POST /api/v1/products/master-catalog/import-csv - Import CSV (multipart)
router.post(
  "/master-catalog/import-csv",
  requirePermission("admin.product.approve", "product.create"),
  upload.single("file"),
  masterCatalogController.importMasterCatalogCsv,
);

// POST /api/v1/products/master-catalog/:id/clone - Clone master product to organization
router.post(
  "/master-catalog/:id/clone",
  requirePermission("product.create", "org.write"),
  masterCatalogController.cloneMasterProduct
);

// GET /api/v1/products - List products
router.get("/", controller.getProducts);

// GET /api/v1/products/:id - Get single product
router.get("/:id", controller.getProduct);

// POST /api/v1/products - Create product (owner-only or owner.products.manage)
router.post(
  "/",
  requireOwnerOrProductManage("product.create", "org.write"),
  controller.createProduct
);

// POST /api/v1/products/:id/versions - Create product version (owner-only or owner.products.manage)
router.post(
  "/:id/versions",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.createProductVersion
);

// PATCH /api/v1/products/:id - Update product (owner-only or owner.products.manage)
router.patch(
  "/:id",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.updateProduct
);

// DELETE /api/v1/products/:id - Delete product (owner-only or owner.products.manage)
router.delete(
  "/:id",
  requireOwnerOrProductManage("product.delete", "org.write"),
  controller.deleteProduct
);

// POST /api/v1/products/:id/variants - Add variant (owner-only or owner.products.manage)
router.post(
  "/:id/variants",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.addVariant
);

// PATCH /api/v1/products/variants/:id - Update variant (owner-only or owner.products.manage)
router.patch(
  "/variants/:id",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.updateVariant
);

// DELETE /api/v1/products/variants/:id - Delete variant (owner-only or owner.products.manage)
router.delete(
  "/variants/:id",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.deleteVariant
);

// ============================
// NEW: Products Module Endpoints
// ============================

// POST /api/v1/products/:id/media - Attach media (owner-only or owner.products.manage)
router.post(
  "/:id/media",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.addMedia
);

// DELETE /api/v1/products/:id/media - Remove product media (owner-only or owner.products.manage)
router.delete(
  "/:id/media",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.deleteMedia
);

// POST /api/v1/products/:id/submit-for-approval - Submit for approval (owner-only or owner.products.manage)
router.post(
  "/:id/submit-for-approval",
  requireOwnerOrProductManage("product.update", "org.write"),
  controller.submitForApproval
);

// POST /api/v1/products/:id/approve - Approve product (admin only)
router.post(
  "/:id/approve",
  requirePermission("admin.product.approve"),
  controller.approveProduct
);

// POST /api/v1/products/versions/:id/approve - Approve product version (admin only)
router.post(
  "/versions/:id/approve",
  requirePermission("admin.product.approve"),
  controller.approveProductVersion
);

// POST /api/v1/products/:id/reject - Reject product (admin only)
router.post(
  "/:id/reject",
  requirePermission("admin.product.approve"),
  controller.rejectProduct
);

// POST /api/v1/products/:id/publish - Publish product (owner-only or owner.products.manage; requires VERIFIED KYC)
router.post(
  "/:id/publish",
  requireOwnerOrProductManage("product.update", "org.write"),
  requireOwnerKycVerified,
  controller.publishProduct
);

module.exports = router;

export {};
