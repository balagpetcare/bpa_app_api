const router = require("express").Router();
const auth = require("../../../../middleware/auth.middleware");
const { requireProducerPermission, requireProducerOwner } = require("../../middlewares/producerAuth");
const ctrl = require("./producer.controller");

// Auth (public)
router.post("/auth/register", ctrl.register);
router.post("/auth/login", ctrl.login);

// KYC + me (auth required)
router.get("/me", auth, requireProducerPermission(["producer.org.read"]), ctrl.me);
router.post("/kyc/submit", auth, requireProducerPermission(["producer.kyc.submit"]), ctrl.submitKyc);
router.get("/kyc/status", auth, requireProducerPermission(["producer.kyc.view"]), ctrl.kycStatus);

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

// Staff Management (owner only)
router.post("/staff", auth, requireProducerOwner, ctrl.inviteStaff);
router.get("/staff", auth, requireProducerPermission(["producer.org.read"]), ctrl.listStaff);
router.patch("/staff/:staffId/role", auth, requireProducerOwner, ctrl.updateStaffRole);
router.delete("/staff/:staffId", auth, requireProducerOwner, ctrl.removeStaff);

module.exports = router;
export {};
