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
router.put('/organizations/:id', ctrl.updateOrganization);
router.delete('/organizations/:id', ctrl.deleteOrganization);

// v1.3 Organization Legal Profile (used by Owner Panel wizard)
router.post('/organizations/:id/legal-profile/save-draft', ctrl.saveOrgLegalDraft);
router.post('/organizations/:id/legal-profile/save-directors', ctrl.saveOrgLegalDirectors);
router.post('/organizations/:id/legal-profile/add-document', ctrl.addOrgLegalDocument);
router.post('/organizations/:id/legal-profile/submit', ctrl.submitOrgLegalProfile);

router.post('/organizations/:id/submit', ctrl.submitOrganization);
router.post('/organizations/:id/cancel', ctrl.cancelOrganization);

// Branches
// ✅ Aggregated branches list for Owner dashboard (sidebar, branches list page)
router.get('/branches', ctrl.listOwnerBranchesAll);

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
router.put('/branches/:id', ctrl.updateBranch);

// Branch product-inventory endpoints
router.get('/branches/:id/products-with-inventory', ctrl.getBranchProductsWithInventory);
router.post('/branches/:id/products/:productId/inventory', ctrl.upsertBranchProductInventory);

// v1.x Branch Profile (used by Owner Panel Branch Registration wizard)
router.post('/branches/:id/profile/save-draft', ctrl.saveBranchProfileDraft);
router.post('/branches/:id/profile/add-document', ctrl.addBranchProfileDocument);
router.post('/branches/:id/profile/submit', ctrl.submitBranchProfile);
router.post('/branches/:id/submit', ctrl.submitBranch);
router.post('/branches/:id/cancel', ctrl.cancelBranch);

// ------------------------------
// Branch Details + Documents (Owner Panel helpers)
// ------------------------------

// Nested branch details (Org -> Branch)
router.get('/organizations/:orgId/branches/:branchId', ctrl.getBranchInOrg);

// Branch documents (aliases to satisfy UI calls)
router.get('/branches/:id/documents', ctrl.listBranchDocuments);
router.get('/branches/:id/profile/documents', ctrl.listBranchDocuments);
router.get('/branches/:id/profile/list-documents', ctrl.listBranchDocuments);

// Verification documents list (legacy dashboard endpoint)
router.get('/verification-documents', ctrl.listVerificationDocuments);

// Staffs (Owner Panel) — BranchMember rows
router.get('/staffs', ctrl.listStaffs);
router.post('/staffs', ctrl.createStaff);
router.get('/staffs/:id', ctrl.getStaff);
router.patch('/staffs/:id', ctrl.updateStaff);
router.patch('/staffs/:id/disable', ctrl.disableStaff);
router.delete('/staffs/:id', ctrl.deleteStaff);

// Product Change Requests (Owner Panel approvals)
router.get('/product-change-requests', ctrl.listProductChangeRequests);
router.get('/product-change-requests/:id', ctrl.getProductChangeRequest);
router.patch('/product-change-requests/:id/approve', ctrl.approveProductChangeRequest);
router.patch('/product-change-requests/:id/reject', ctrl.rejectProductChangeRequest);

// Owner Requests & Approvals (Placeholder per page map)
router.get('/requests', ctrl.getOwnerRequestsInbox);
router.get('/product-requests', ctrl.listOwnerProductRequests);
router.post('/product-requests', ctrl.createOwnerProductRequest);
router.post('/product-requests/:id/approve', ctrl.approveOwnerProductRequest);
router.post('/product-requests/:id/reject', ctrl.rejectOwnerProductRequest);
router.post('/product-requests/:id/create-transfer', ctrl.createOwnerProductRequestTransfer);

// Owner Inventory Transfers (Placeholder)
router.post('/inventory/transfers', ctrl.createOwnerInventoryTransfer);
router.post('/inventory/transfers/:id/dispatch', ctrl.dispatchOwnerInventoryTransfer);
router.post('/inventory/transfers/:id/close', ctrl.closeOwnerInventoryTransfer);

// Stock Adjustment Requests (Owner Panel approvals)
router.get('/adjustment-requests', ctrl.listStockAdjustmentRequests);
router.patch('/adjustment-requests/:id/approve', ctrl.approveStockAdjustmentRequest);
router.patch('/adjustment-requests/:id/reject', ctrl.rejectStockAdjustmentRequest);

// Branch access (owner-only: list / approve / reject)
router.get('/branch-access', ctrl.listBranchAccess);
router.post('/branch-access/:id/approve', ctrl.approveBranchAccessOwner);
router.post('/branch-access/:id/reject', ctrl.rejectBranchAccessOwner);
router.post('/branch-access/assign', ctrl.assignBranchAccessOwner);
router.post('/branch-access/:id/suspend', ctrl.suspendBranchAccessOwner);
router.post('/branch-access/:id/remove', ctrl.removeBranchAccessOwner);
router.post('/branch-access/:id/role', ctrl.updateBranchAccessRoleOwner);
router.get('/branch-access/:id', ctrl.getBranchAccessRequestDetail);

router.get('/staff-access/staff', ctrl.listOwnerStaffAccess);
router.get('/staff-access/staff/:userId/branch-access', ctrl.getOwnerStaffBranchAccess);

router.get('/notifications', ctrl.listOwnerNotifications);
router.post('/notifications/:id/read', ctrl.markOwnerNotificationRead);

// Dashboard endpoints
router.get('/dashboard/metrics', ctrl.getDashboardMetrics);
router.get('/dashboard/revenue', ctrl.getDashboardRevenue);
router.get('/dashboard/sales-by-branch', ctrl.getDashboardSalesByBranch);
router.get('/dashboard/top-products', ctrl.getDashboardTopProducts);
router.get('/dashboard/recent-activity', ctrl.getDashboardRecentActivity);
router.get('/dashboard/alerts', ctrl.getDashboardAlerts);

// Product management endpoints
router.get('/products/summary', ctrl.getProductsSummary);
router.get('/products/branch-availability', ctrl.getProductBranchAvailability);
router.post('/products/:id/add-to-branches', ctrl.addProductToBranches);

module.exports = router;

export {};
