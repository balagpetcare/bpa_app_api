const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_verifications.controller");

router.get("/stats", authenticateToken, adminOnly, ctrl.getVerificationStats);

// Owners
router.get("/owners", authenticateToken, adminOnly, ctrl.listOwnerKycs);
router.get("/owners/:id", authenticateToken, adminOnly, ctrl.getOwnerKyc);
router.post("/owners/:id/approve", authenticateToken, adminOnly, ctrl.approveOwnerKyc);
router.post("/owners/:id/reject", authenticateToken, adminOnly, ctrl.rejectOwnerKyc);
router.post(
  "/owners/:id/request-changes",
  authenticateToken,
  adminOnly,
  ctrl.requestChangesOwnerKyc
);
router.post("/owners/:id/suspend", authenticateToken, adminOnly, ctrl.suspendOwnerKyc);
router.post("/owners/:id/comment", authenticateToken, adminOnly, ctrl.commentOwnerKyc);

// Organizations
router.get("/organizations", authenticateToken, adminOnly, ctrl.listOrgKycs);
router.get("/organizations/:id", authenticateToken, adminOnly, ctrl.getOrgKyc);
router.post("/organizations/:id/approve", authenticateToken, adminOnly, ctrl.approveOrgKyc);
router.post("/organizations/:id/reject", authenticateToken, adminOnly, ctrl.rejectOrgKyc);
router.post(
  "/organizations/:id/request-changes",
  authenticateToken,
  adminOnly,
  ctrl.requestChangesOrgKyc
);
router.post("/organizations/:id/suspend", authenticateToken, adminOnly, ctrl.suspendOrgKyc);
router.post("/organizations/:id/comment", authenticateToken, adminOnly, ctrl.commentOrgKyc);

// Producer Orgs (Product Authenticity)
router.get("/producer-orgs", authenticateToken, adminOnly, ctrl.listProducerOrgs);
router.get("/producer-orgs/:id", authenticateToken, adminOnly, ctrl.getProducerOrg);
router.post("/producer-orgs/:id/approve", authenticateToken, adminOnly, ctrl.approveProducerOrg);
router.post("/producer-orgs/:id/reject", authenticateToken, adminOnly, ctrl.rejectProducerOrg);
router.post(
  "/producer-orgs/:id/request-changes",
  authenticateToken,
  adminOnly,
  ctrl.requestChangesProducerOrg
);
router.post("/producer-orgs/:id/suspend", authenticateToken, adminOnly, ctrl.suspendProducerOrg);
router.post("/producer-orgs/:id/comment", authenticateToken, adminOnly, ctrl.commentProducerOrg);

// Producer Products queue (UNDER_REVIEW → ACTIVE by platform admin)
router.get("/producer-products", authenticateToken, adminOnly, ctrl.listProducerProducts);
router.get("/producer-products/:id", authenticateToken, adminOnly, ctrl.getProducerProduct);
router.post("/producer-products/:id/approve", authenticateToken, adminOnly, ctrl.approveProducerProduct);
router.post("/producer-products/:id/reject", authenticateToken, adminOnly, ctrl.rejectProducerProduct);

// Backward-compatible alias (older UI used /orgs)
router.get("/orgs", authenticateToken, adminOnly, ctrl.listOrgKycs);

// Branches
router.get("/branches", authenticateToken, adminOnly, ctrl.listBranchKycs);
router.get("/branches/:id", authenticateToken, adminOnly, ctrl.getBranchKyc);
router.post("/branches/:id/approve", authenticateToken, adminOnly, ctrl.approveBranchKyc);
router.post("/branches/:id/reject", authenticateToken, adminOnly, ctrl.rejectBranchKyc);
router.post(
  "/branches/:id/request-changes",
  authenticateToken,
  adminOnly,
  ctrl.requestChangesBranchKyc
);
router.post("/branches/:id/suspend", authenticateToken, adminOnly, ctrl.suspendBranchKyc);
router.post("/branches/:id/comment", authenticateToken, adminOnly, ctrl.commentBranchKyc);

// Staff
router.get("/staff", authenticateToken, adminOnly, ctrl.listStaffVerifications);
router.get("/staff/:id", authenticateToken, adminOnly, ctrl.getStaffVerification);
router.post("/staff/:id/approve", authenticateToken, adminOnly, ctrl.approveStaffVerification);
router.post("/staff/:id/reject", authenticateToken, adminOnly, ctrl.rejectStaffVerification);
router.post("/staff/:id/request-changes", authenticateToken, adminOnly, ctrl.requestChangesStaffVerification);
router.post("/staff/:id/suspend", authenticateToken, adminOnly, ctrl.suspendStaffVerification);
router.post("/staff/:id/comment", authenticateToken, adminOnly, ctrl.commentStaffVerification);

// Doctor verification (clinic doctor KYC queue)
router.get("/doctors", authenticateToken, adminOnly, ctrl.listDoctorVerifications);
router.get("/doctors/:id", authenticateToken, adminOnly, ctrl.getDoctorVerification);
router.post("/doctors/:id/approve", authenticateToken, adminOnly, ctrl.approveDoctorVerification);
router.post("/doctors/:id/reject", authenticateToken, adminOnly, ctrl.rejectDoctorVerification);

module.exports = router;

export {};
