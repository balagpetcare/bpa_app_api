const router = require('express').Router();
const auth = require('../../../../middlewares/auth');
const roleGuard = require('../../../../middlewares/roleGuard');
const ctrl = require('./owner.controller');
const vctrl = require('./owner.verification.controller');
const multer = require('multer');

// v1.2: owner KYC document upload (multipart)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024) // default 15MB
  }
});

router.use(auth, roleGuard(['OWNER']));

// v1.1 Owner account/profile/KYC
router.get('/me', ctrl.getOwnerMe);
router.get('/profile', ctrl.getOwnerProfile);
router.put('/profile', ctrl.upsertOwnerProfile);
router.get('/kyc', ctrl.getOwnerKyc);
router.put('/kyc', ctrl.upsertOwnerKycDraft);
router.post('/kyc/documents', upload.single('file'), ctrl.uploadOwnerKycDocument);
router.delete('/kyc/documents/:id', ctrl.deleteOwnerKycDocument);
router.post('/kyc/submit', ctrl.submitOwnerKyc);

// ------------------------------
// V2: Universal Verification (Owner/Org/Branch) — add-only, non-breaking
// Owner Panel should use these endpoints. Flutter/public APIs remain untouched.
// ------------------------------
router.get('/verification-case', vctrl.getVerificationCase);
router.put('/verification-case/draft', vctrl.updateVerificationDraft);
router.post('/verification-case/documents', upload.single('file'), vctrl.uploadVerificationDocument);
router.delete('/verification-case/documents/:id', vctrl.deleteVerificationDocument);
router.post('/verification-case/submit', vctrl.submitVerificationCase);
// V3: Approved -> Request change -> new DRAFT case (re-verification)
router.post('/verification-case/request-change', vctrl.requestVerificationChange);

// Organizations
router.post('/organizations', ctrl.createOrganization);
router.get('/organizations', ctrl.listOrganizations);
router.get('/organizations/:id', ctrl.getOrganization);
router.patch('/organizations/:id', ctrl.updateOrganization);
// Owner Panel uses PUT for edits; keep PATCH for partial updates.


// Product Change Requests (Owner approval queue)
router.get('/product-change-requests', ctrl.listProductChangeRequests);
router.patch('/product-change-requests/:id/approve', ctrl.approveProductChangeRequest);
router.patch('/product-change-requests/:id/reject', ctrl.rejectProductChangeRequest);

router.put('/organizations/:id', ctrl.updateOrganization);

// v1.3 Organization Legal Profile (used by Owner Panel wizard)
router.post('/organizations/:id/legal-profile/save-draft', ctrl.saveOrgLegalDraft);
router.post('/organizations/:id/legal-profile/save-directors', ctrl.saveOrgLegalDirectors);
router.post('/organizations/:id/legal-profile/add-document', ctrl.addOrgLegalDocument);
router.post('/organizations/:id/legal-profile/submit', ctrl.submitOrgLegalProfile);

router.post('/organizations/:id/submit', ctrl.submitOrganization);
router.post('/organizations/:id/cancel', ctrl.cancelOrganization);

// Branches
// Branch Members (staff, sellers, delivery hub staff)
// Branch Member Invites (token-based; no temp password in API response)
router.post('/branches/:id/members/invite', ctrl.inviteBranchMember);

router.get('/branches/:id/members', ctrl.listBranchMembers);
router.post('/branches/:id/members', ctrl.addBranchMember);
router.patch('/branches/:id/members/:memberId', ctrl.updateBranchMember);

router.post('/organizations/:orgId/branches', ctrl.createBranch);
router.get('/organizations/:orgId/branches', ctrl.listBranches);
router.get('/branches/:id', ctrl.getBranch);
router.patch('/branches/:id', ctrl.updateBranch);
// Owner Panel uses PUT for edits; keep PATCH for partial updates.


// Product Change Requests (Owner approval queue)
router.get('/product-change-requests', ctrl.listProductChangeRequests);
router.patch('/product-change-requests/:id/approve', ctrl.approveProductChangeRequest);
router.patch('/product-change-requests/:id/reject', ctrl.rejectProductChangeRequest);

router.put('/branches/:id', ctrl.updateBranch);

// v1.x Branch Profile (used by Owner Panel Branch Registration wizard)
router.post('/branches/:id/profile/save-draft', ctrl.saveBranchProfileDraft);
router.post('/branches/:id/profile/add-document', ctrl.addBranchProfileDocument);
router.post('/branches/:id/profile/submit', ctrl.submitBranchProfile);
router.post('/branches/:id/submit', ctrl.submitBranch);
router.post('/branches/:id/cancel', ctrl.cancelBranch);

module.exports = router;

export {};
