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
// Pending staff invites for any logged-in user (invitee may not be producer yet)
router.get("/me/pending-invites", auth, ctrl.getPendingInvites);
// New KYC (VerificationCase + documents)
router.get("/kyc/status", auth, requireProducerPermission(["producer.kyc.view"]), kycCtrl.getKycStatus);
router.post("/kyc/submit", auth, requireProducerPermission(["producer.kyc.submit"]), ctrl.submitKycLegacyOrNew);
router.post("/kyc/documents", auth, requireProducerPermission(["producer.kyc.submit"]), upload.single("file"), kycCtrl.uploadDocument);
// Legacy KYC status (backward compat; returns org; prefer GET /kyc/status for new UI)
router.get("/kyc/status/legacy", auth, requireProducerPermission(["producer.kyc.view"]), ctrl.kycStatus);

// Factories (permission-based; required for product submission)
router.get("/factories", auth, requireProducerPermission(["producer.products.read"]), ctrl.listFactories);
router.post("/factories", auth, requireProducerPermission(["producer.products.write"]), ctrl.createFactory);

// Products (permission-based)
router.get("/products", auth, requireProducerPermission(["producer.products.read"]), ctrl.listProducts);
router.post("/products", auth, requireProducerPermission(["producer.products.write"]), ctrl.createProduct);
router.get("/products/:id", auth, requireProducerPermission(["producer.products.read"]), ctrl.getProduct);
router.get("/products/:id/status", auth, requireProducerPermission(["producer.products.read"]), ctrl.getProductStatus);
router.patch("/products/:id", auth, requireProducerPermission(["producer.products.write"]), ctrl.updateProduct);
router.post("/products/:id/submit", auth, requireProducerPermission(["producer.products.write"]), ctrl.submitProduct);
router.post("/products/:id/proofs", auth, requireProducerPermission(["producer.products.write"]), upload.single("file"), ctrl.addProductProof);
router.post("/products/:id/batches", auth, requireProducerPermission(["producer.batches.write"]), ctrl.createBatch);

// Batches (permission-based)
router.get("/batches", auth, requireProducerPermission(["producer.batches.read"]), ctrl.listBatches);
router.get("/batches/:id", auth, requireProducerPermission(["producer.batches.read"]), ctrl.getBatch);
router.post("/batches/:id/submit", auth, requireProducerPermission(["producer.batches.write"]), ctrl.submitBatch);
router.post("/batches/:batchId/codes/generate", auth, requireProducerPermission(["producer.codes.generate"]), ctrl.generateCodes);
router.get("/batches/:batchId/codes/export", auth, requireProducerPermission(["producer.codes.export"]), ctrl.exportCodes);

// Code search
router.get("/codes/search", auth, requireProducerPermission(["producer.codes.generate"]), ctrl.searchCode);

router.get("/audit-logs", auth, requireProducerPermission(["producer.org.read"]), ctrl.listAuditLogs);
router.get("/approvals", auth, requireProducerOwner, ctrl.listApprovals);
router.post("/approvals/:id/approve", auth, requireProducerOwner, ctrl.approveApproval);
router.post("/approvals/:id/reject", auth, requireProducerOwner, ctrl.rejectApproval);

// Staff Management (owner only for invite/role/status/remove; requires verified producer for invite)
router.post("/staff", auth, requireProducerOwner, requireProducerVerified, ctrl.inviteStaff);
router.get("/staff", auth, requireProducerPermission(["producer.org.read"]), ctrl.listStaff);
router.patch("/staff/:staffId/role", auth, requireProducerOwner, ctrl.updateStaffRole);
router.patch("/staff/:staffId/status", auth, requireProducerOwner, ctrl.updateStaffStatus);
router.delete("/staff/:staffId", auth, requireProducerOwner, ctrl.removeStaff);

// Staff Invites (new workflow: registered → notification accept; unregistered → token link)
router.post("/staff/invite", auth, requireProducerOwner, requireProducerVerified, ctrl.createStaffInvite);
router.get("/staff/invites", auth, requireProducerOwner, ctrl.listStaffInvites);
router.post("/staff/invites/accept-public", ctrl.acceptStaffInvitePublic);
// Accept/decline first (static path before :id)
router.post("/staff/invites/accept", auth, ctrl.acceptStaffInvite);
router.post("/staff/invites/decline", auth, ctrl.declineStaffInvite);
router.post("/staff/invites/:id/cancel", auth, requireProducerOwner, ctrl.cancelStaffInvite);

module.exports = router;
export {};
