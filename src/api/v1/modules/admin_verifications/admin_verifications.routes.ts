const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_verifications.controller");

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

module.exports = router;

export {};
