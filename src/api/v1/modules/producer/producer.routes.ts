const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const multer = require("multer");
const { requireProducerPermission, requireProducerOwner } = require("../../middlewares/producerAuth");
const requireProducerVerified = require("../../middlewares/requireProducerVerified");
const ctrl = require("./producer.controller");
const kycCtrl = require("./producerKyc.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024) },
});

// Auth (public)
router.post("/auth/register", ctrl.register);
router.post("/auth/login", ctrl.login);

// KYC + me (auth required)
router.get("/me", auth, requireProducerPermission(["producer.org.read"]), ctrl.me);
// New KYC (VerificationCase + documents)
router.get("/kyc/status", auth, requireProducerPermission(["producer.kyc.view"]), kycCtrl.getKycStatus);
router.post("/kyc/submit", auth, requireProducerPermission(["producer.kyc.submit"]), ctrl.submitKycLegacyOrNew);
router.post("/kyc/documents", auth, requireProducerPermission(["producer.kyc.submit"]), upload.single("file"), kycCtrl.uploadDocument);
// Legacy KYC status (backward compat; returns org; prefer GET /kyc/status for new UI)
router.get("/kyc/status/legacy", auth, requireProducerPermission(["producer.kyc.view"]), ctrl.kycStatus);

// Products (permission-based)
router.get("/products", auth, requireProducerPermission(["producer.products.read"]), ctrl.listProducts);
router.post("/products", auth, requireProducerPermission(["producer.products.write"]), ctrl.createProduct);
router.get("/products/:id", auth, requireProducerPermission(["producer.products.read"]), ctrl.getProduct);
router.post("/products/:id/batches", auth, requireProducerPermission(["producer.batches.write"]), ctrl.createBatch);

// Batches (permission-based)
router.get("/batches", auth, requireProducerPermission(["producer.batches.read"]), ctrl.listBatches);
router.get("/batches/:id", auth, requireProducerPermission(["producer.batches.read"]), ctrl.getBatch);
router.post("/batches/:batchId/codes/generate", auth, requireProducerPermission(["producer.codes.generate"]), ctrl.generateCodes);
router.get("/batches/:batchId/codes/export", auth, requireProducerPermission(["producer.codes.export"]), ctrl.exportCodes);

// Code search
router.get("/codes/search", auth, requireProducerPermission(["producer.codes.generate"]), ctrl.searchCode);

// Staff Management (owner only; requires verified producer)
router.post("/staff", auth, requireProducerOwner, requireProducerVerified, ctrl.inviteStaff);
router.get("/staff", auth, requireProducerPermission(["producer.org.read"]), ctrl.listStaff);
router.patch("/staff/:staffId/role", auth, requireProducerOwner, ctrl.updateStaffRole);
router.delete("/staff/:staffId", auth, requireProducerOwner, ctrl.removeStaff);

module.exports = router;
export {};
