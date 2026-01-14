const router = require("express").Router();

const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./partner_onboarding.controller");

// Partner Application
router.post("/applications", authenticateToken, ctrl.submitApplication);
router.get("/applications/me", authenticateToken, ctrl.getMyApplication);

// ------------------------------
// Compatibility endpoints (for Partner Next.js onboarding wizard)
// ------------------------------
// Draft = PartnerStatus.NOT_APPLIED
router.post("/applications/draft", authenticateToken, ctrl.createOrGetDraft);
router.get("/applications", authenticateToken, ctrl.listMyApplications);
router.get("/applications/:id", authenticateToken, ctrl.getApplicationById);
router.patch("/applications/:id", authenticateToken, ctrl.updateDraft);
router.post("/applications/:id/submit", authenticateToken, ctrl.submitDraft);

// Organization
router.post("/organizations", authenticateToken, ctrl.createOrganization);
router.get("/organizations", authenticateToken, ctrl.listMyOrganizations);

// Branch
router.post("/organizations/:orgId/branches", authenticateToken, ctrl.createBranch);
router.patch("/branches/:branchId", authenticateToken, ctrl.updateBranch);
router.post("/branches/:branchId/publish", authenticateToken, ctrl.submitPublishRequest);
router.get("/branches/:branchId/publish", authenticateToken, ctrl.getPublishStatus);

module.exports = router;
