const router = require("express").Router();
const multer = require("multer");
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const ctrl = require("./admin_medicine_import.controller");
const { productImportUploadLimiter } = require("../../../../middleware/rateLimiters");
const { MEDICINE_IMPORT_MAX_FILE_BYTES } = require("../../constants/medicineImportLimits");

const medImport = requirePermission("medicine.catalog.import", "medicine.master.write", "medicine.catalog.governance");
const medGovernance = requirePermission("medicine.catalog.governance");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDICINE_IMPORT_MAX_FILE_BYTES },
});

router.post(
  "/upload",
  authenticateToken,
  adminOnly,
  medImport,
  productImportUploadLimiter,
  upload.single("file"),
  ctrl.upload
);

router.get("/batches", authenticateToken, adminOnly, medImport, ctrl.listBatches);
router.get("/batches/:id", authenticateToken, adminOnly, medImport, ctrl.getBatch);
router.get("/batches/:id/rows", authenticateToken, adminOnly, medImport, ctrl.listRows);
router.get("/batches/:id/export-invalid", authenticateToken, adminOnly, medImport, ctrl.exportInvalid);
router.get("/batches/:id/export-classification", authenticateToken, adminOnly, medImport, ctrl.exportClassification);
router.post("/batches/:id/preview", authenticateToken, adminOnly, medImport, ctrl.preview);
router.post("/batches/:id/confirm", authenticateToken, adminOnly, medImport, ctrl.confirm);
router.post("/batches/:id/apply", authenticateToken, adminOnly, medImport, ctrl.apply);
router.post("/batches/:id/cancel", authenticateToken, adminOnly, medImport, ctrl.cancel);
router.post("/batches/:id/purge", authenticateToken, adminOnly, medGovernance, ctrl.purgeBatch);

module.exports = router;
export {};
