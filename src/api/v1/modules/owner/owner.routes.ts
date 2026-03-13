const router = require('express').Router();
const auth = require('../../../../middlewares/auth');
const roleGuard = require('../../../../middlewares/roleGuard');
const ownerPanelGuard = require('../../../../middlewares/ownerPanelGuard');
const ensureOwnerKyc = require('../../../../middlewares/ensureOwnerKyc');
const requireOwnerKycVerified = require('../../../../middlewares/requireOwnerKycVerified');
const { requireOwnerPermission } = require('../../../../middlewares/requireOwnerScope');
const { requireOwnerContext } = require('../../../../middlewares/requireOwnerContext');
const { requireTeamOwner } = require('../../../../middlewares/requireTeamOwner');

const teamDashboardGuard = [requireOwnerContext, requireOwnerPermission('TEAM_MANAGE', null)];
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

// All owner routes require auth
router.use(auth);

// Onboarding: profile + KYC — allow any authenticated user (USER, OWNER, ADMIN) so users
// without OwnerProfile yet can complete onboarding and create profile/kyc
router.get('/me', ctrl.getOwnerMe);
router.get('/me/pets', ctrl.listMyPets);
router.get('/me/pets/:petId', ctrl.getMyPet);
router.get('/profile', ctrl.getOwnerProfile);
router.put('/profile', ctrl.upsertOwnerProfile);
router.get('/kyc', ctrl.getOwnerKyc);
router.put('/kyc', ctrl.upsertOwnerKycDraft);
router.post('/kyc/documents', upload.single('file'), ctrl.uploadOwnerKycDocument);
router.delete('/kyc/documents/:id', ctrl.deleteOwnerKycDocument);
router.post('/kyc/submit', ctrl.submitOwnerKyc);

// Rest of owner panel — allow OWNER, ADMIN, STAFF, TEAM (RBAC applied per-route / per-handler)
router.use(ownerPanelGuard());
// #region agent log
router.use((req, res, next) => {
  if ((req.path || req.url || '').includes('catalog/import')) {
    fetch('http://127.0.0.1:7242/ingest/8587e4aa-5cb6-4181-b813-5bca1da63be3', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7204b9' }, body: JSON.stringify({ sessionId: '7204b9', hypothesisId: 'B_C', location: 'owner.routes.ts:ownerRouter', message: 'request reached owner router', data: { method: req.method, path: req.path, url: req.url, baseUrl: req.baseUrl, originalUrl: req.originalUrl }, timestamp: Date.now() }) }).catch(() => {});
  }
  next();
});
// #endregion
// Master catalog (browse + add-from-master) — register first so GET .../catalog/master/* always matches
const clinicCtrl = require('./ownerClinic.controller');
router.get('/clinic/branches/:branchId/catalog/master/categories', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listMasterCatalogCategories);
router.get('/clinic/branches/:branchId/catalog/master/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listMasterCatalogItems);
router.post('/clinic/branches/:branchId/catalog/add-from-master/preview', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.previewAddFromMasterCatalog);
router.post('/clinic/branches/:branchId/catalog/add-from-master/execute', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.executeAddFromMasterCatalog);
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

// Organizations (KYC required: at least SUBMITTED with one document)
router.post('/organizations', ensureOwnerKyc, ctrl.createOrganization);
router.get('/organizations', ctrl.listOrganizations);
router.get('/organizations/:id', ctrl.getOrganization);
router.patch('/organizations/:id', requireOwnerPermission('org.write', 'organization'), ctrl.updateOrganization);
// Owner Panel uses PUT for edits; keep PATCH for partial updates.
router.put('/organizations/:id', requireOwnerPermission('org.write', 'organization'), ctrl.updateOrganization);
router.delete('/organizations/:id', requireOwnerPermission('org.write', 'organization'), ctrl.deleteOrganization);

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
// Branch Member Invites (token-based; no temp password in API response) — requires VERIFIED KYC
router.post('/branches/:id/members/invite', requireOwnerKycVerified, ctrl.inviteBranchMember);

router.get('/branches/:id/members', ctrl.listBranchMembers);
router.post('/branches/:id/members', ctrl.addBranchMember);
router.patch('/branches/:id/members/:memberId', ctrl.updateBranchMember);

router.post('/organizations/:orgId/branches', ensureOwnerKyc, ctrl.createBranch);
router.get('/organizations/:orgId/branches', ctrl.listBranches);
router.get('/branches/:id', ctrl.getBranch);
router.patch('/branches/:id', requireOwnerPermission('branch.write', 'branch'), ctrl.updateBranch);
// Owner Panel uses PUT for edits; keep PATCH for partial updates.
router.put('/branches/:id', requireOwnerPermission('branch.write', 'branch'), ctrl.updateBranch);

// Branch product-inventory endpoints
router.get('/branches/:id/products-with-inventory', ctrl.getBranchProductsWithInventory);
router.post('/branches/:id/products/:productId/inventory', ctrl.upsertBranchProductInventory);

// v1.x Branch Profile (used by Owner Panel Branch Registration wizard)
router.post('/branches/:id/profile/save-draft', ctrl.saveBranchProfileDraft);
router.post('/branches/:id/profile/add-document', ctrl.addBranchProfileDocument);
router.post('/branches/:id/profile/submit', ctrl.submitBranchProfile);
router.post('/branches/:id/submit', requireOwnerKycVerified, ctrl.submitBranch);
router.post('/branches/:id/cancel', ctrl.cancelBranch);

// ------------------------------
// Branch Details + Documents (Owner Panel helpers)
// ------------------------------

// Nested branch details (Org -> Branch)
router.get('/organizations/:orgId/branches/:branchId', ctrl.getBranchInOrg);

// ------------------------------
// Clinic Setup (Owner Panel: clinic branches, settings, services, staff)
// ------------------------------
// Catalog import: mount sub-router so POST .../catalog/import/preview and .../execute are matched
const catalogImportRouter = require('express').Router({ mergeParams: true });
// #region agent log
catalogImportRouter.use((req, res, next) => {
  fetch('http://127.0.0.1:7242/ingest/8587e4aa-5cb6-4181-b813-5bca1da63be3', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7204b9' }, body: JSON.stringify({ sessionId: '7204b9', hypothesisId: 'D', location: 'owner.routes.ts:catalogImportRouter', message: 'request reached catalog import sub-router', data: { method: req.method, path: req.path, url: req.url, baseUrl: req.baseUrl }, timestamp: Date.now() }) }).catch(() => {});
  next();
});
// #endregion
catalogImportRouter.post('/preview', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.previewCatalogImport);
catalogImportRouter.post('/execute', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.executeCatalogImport);
router.use('/clinic/branches/:branchId/catalog/import', catalogImportRouter);
router.get('/clinic/branches', requireOwnerPermission('clinic.overview.read', null), clinicCtrl.listClinicBranches);
router.get('/clinic/network-stats', requireOwnerPermission('clinic.overview.read', null), clinicCtrl.getClinicNetworkStats);
router.get('/clinic/branches/:branchId/dashboard-stats', requireOwnerPermission('clinic.overview.read', 'branch'), clinicCtrl.getClinicDashboardStats);
router.get('/clinic/branches/:branchId/modules/clinic', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicModule);
router.patch('/clinic/branches/:branchId/modules/clinic', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.updateClinicModule);
router.get('/clinic/branches/:branchId/settings', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicSettings);
router.put('/clinic/branches/:branchId/settings', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.updateClinicSettings);
// Catalog: templates, install, import (register early so /catalog/import/preview is matched)
router.get('/clinic/branches/:branchId/catalog/templates', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listCatalogTemplates);
router.get('/clinic/branches/:branchId/catalog/templates/:templateId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getCatalogTemplateById);
router.post('/clinic/branches/:branchId/catalog/install/preview', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.previewCatalogInstall);
router.post('/clinic/branches/:branchId/catalog/install', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.installCatalogTemplate);
router.get('/clinic/branches/:branchId/catalog/install-history', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getCatalogInstallHistory);
router.get('/clinic/branches/:branchId/catalog/install/upgrade-check/:templateId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getCatalogUpgradeCheck);
router.get('/clinic/branches/:branchId/services', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicServices);
router.post('/clinic/branches/:branchId/services', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicService);
router.patch('/clinic/branches/:branchId/services/:serviceId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicService);
router.delete('/clinic/branches/:branchId/services/:serviceId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicService);
router.get('/clinic/branches/:branchId/services/:serviceId/variants', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicServiceVariants);
router.put('/clinic/branches/:branchId/services/:serviceId/variants', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.putClinicServiceVariants);
router.get('/clinic/branches/:branchId/service-proposals', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicServiceProposals);
router.post('/clinic/branches/:branchId/service-proposals/:proposalId/review', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.reviewClinicServiceProposal);
router.get('/clinic/branches/:branchId/staff', requireOwnerPermission('clinic.overview.read', 'branch'), clinicCtrl.listClinicStaff);
router.get('/clinic/branches/:branchId/staff/:memberId/profile', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicStaffProfile);
router.put('/clinic/branches/:branchId/staff/:memberId/profile', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.upsertClinicStaffProfile);
router.post('/clinic/branches/:branchId/staff/:memberId/assign-template', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.assignClinicRoleTemplate);
router.patch('/clinic/branches/:branchId/staff/:memberId/permissions', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.updateClinicStaffPermissions);
router.get('/clinic/branches/:branchId/schedule-board', requireOwnerPermission('clinic.rooms.view_schedule', 'branch'), clinicCtrl.getScheduleBoard);
router.get('/clinic/branches/:branchId/rooms', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.listClinicRooms);
router.get('/clinic/branches/:branchId/rooms/live', requireOwnerPermission('clinic.rooms.view_live', 'branch'), clinicCtrl.getRoomsLiveState);
router.delete('/clinic/branches/:branchId/rooms/blocks/:blockId', requireOwnerPermission('clinic.rooms.manage_blocks', 'branch'), clinicCtrl.releaseRoomBlock);
router.get('/clinic/branches/:branchId/rooms/:roomId', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.getClinicRoom);
router.get('/clinic/branches/:branchId/rooms/:roomId/audit', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.getClinicRoomAudit);
router.get('/clinic/branches/:branchId/rooms/:roomId/schedule', requireOwnerPermission('clinic.rooms.view_schedule', 'branch'), clinicCtrl.getRoomSchedule);
router.get('/clinic/branches/:branchId/rooms/:roomId/live', requireOwnerPermission('clinic.rooms.view_live', 'branch'), clinicCtrl.getRoomLiveState);
router.post('/clinic/branches/:branchId/rooms/:roomId/blocks', requireOwnerPermission('clinic.rooms.manage_blocks', 'branch'), clinicCtrl.createRoomBlock);
router.post('/clinic/branches/:branchId/rooms', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.createClinicRoom);
router.patch('/clinic/branches/:branchId/rooms/:roomId', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.updateClinicRoom);
router.delete('/clinic/branches/:branchId/rooms/:roomId', requireOwnerPermission('clinic.rooms.manage', null), clinicCtrl.deleteClinicRoom);
router.get('/clinic/branches/:branchId/schedule/templates', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.getScheduleTemplates);
router.put('/clinic/branches/:branchId/schedule/templates', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.putScheduleTemplates);
router.get('/clinic/branches/:branchId/holidays', requireOwnerPermission('clinic.holidays.manage', 'branch'), clinicCtrl.listHolidays);
router.post('/clinic/branches/:branchId/holidays', requireOwnerPermission('clinic.holidays.manage', 'branch'), clinicCtrl.createHoliday);
router.delete('/clinic/branches/:branchId/holidays/:holidayId', requireOwnerPermission('clinic.holidays.manage', 'branch'), clinicCtrl.deleteHoliday);
router.get('/clinic/branches/:branchId/policy/emergency', requireOwnerPermission('clinic.emergency.manage', 'branch'), clinicCtrl.getEmergencyPolicy);
router.put('/clinic/branches/:branchId/policy/emergency', requireOwnerPermission('clinic.emergency.manage', 'branch'), clinicCtrl.updateEmergencyPolicy);
router.get('/clinic/branches/:branchId/fees', requireOwnerPermission('clinic.fees.manage', 'branch'), clinicCtrl.getClinicFees);
router.put('/clinic/branches/:branchId/fees', requireOwnerPermission('clinic.fees.manage', 'branch'), clinicCtrl.updateClinicFees);

// Clinic Phase 2: Appointments + Schedule Exceptions
router.get('/clinic/branches/:branchId/appointments', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.listClinicAppointments);
router.get('/clinic/branches/:branchId/slots', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.getClinicSlots);
router.get('/clinic/branches/:branchId/booking/available-slots', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.getClinicBookingAvailableSlots);
router.get('/clinic/branches/:branchId/booking/eligible-doctors', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.getClinicBookingEligibleDoctors);
router.get('/clinic/branches/:branchId/booking/price-preview', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.getClinicBookingPricePreview);
router.get('/clinic/branches/:branchId/booking/constraints', requireOwnerPermission('clinic.appointments.read', 'branch'), clinicCtrl.getClinicBookingConstraints);
router.post('/clinic/branches/:branchId/appointments', requireOwnerPermission('clinic.appointments.manage', 'branch'), clinicCtrl.createClinicAppointment);
router.post('/clinic/branches/:branchId/appointments/:appointmentId/confirm', requireOwnerPermission('clinic.appointments.manage', 'branch'), clinicCtrl.confirmClinicAppointment);
router.post('/clinic/branches/:branchId/appointments/:appointmentId/cancel', requireOwnerPermission('clinic.appointments.manage', 'branch'), clinicCtrl.cancelClinicAppointment);
router.post('/clinic/branches/:branchId/appointments/:appointmentId/reschedule', requireOwnerPermission('clinic.appointments.manage', 'branch'), clinicCtrl.rescheduleClinicAppointment);
router.get('/clinic/branches/:branchId/schedule/exceptions', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.listClinicScheduleExceptions);
router.post('/clinic/branches/:branchId/schedule/exceptions', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.createClinicScheduleException);
router.delete('/clinic/branches/:branchId/schedule/exceptions/:exceptionId', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.deleteClinicScheduleException);
// Doctor management (CP1)
router.get('/clinic/branches/:branchId/doctors', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listClinicDoctors);
router.post('/clinic/branches/:branchId/doctors/invite', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.inviteClinicDoctor);
router.get('/clinic/branches/:branchId/doctors/:memberId', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorDetail);
router.get('/clinic/branches/:branchId/doctor-requests', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listDoctorRequests);
router.post('/clinic/branches/:branchId/doctor-requests/:requestId/approve', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.approveDoctorRequest);
router.post('/clinic/branches/:branchId/doctor-requests/:requestId/reject', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.rejectDoctorRequest);
router.patch('/clinic/branches/:branchId/doctors/:memberId/terms', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.patchClinicDoctorTerms);
router.put('/clinic/branches/:branchId/doctors/:memberId/services', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.putClinicDoctorServices);
router.get('/clinic/branches/:branchId/doctors/:memberId/metrics', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorMetrics);
router.get('/clinic/branches/:branchId/doctors/:memberId/capacity', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorCapacity);
router.get('/clinic/branches/:branchId/doctors/:memberId/settlement-ledger', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listClinicDoctorSettlementLedger);
router.get('/clinic/branches/:branchId/doctors/:memberId/audit-log', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listClinicDoctorAuditLog);
// Clinic Enterprise: Surgery packages
router.get('/clinic/branches/:branchId/packages', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicPackages);
router.get('/clinic/branches/:branchId/packages/:packageId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicPackageById);
router.post('/clinic/branches/:branchId/packages', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicPackage);
router.patch('/clinic/branches/:branchId/packages/:packageId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicPackage);
router.delete('/clinic/branches/:branchId/packages/:packageId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicPackage);
router.get('/clinic/branches/:branchId/packages/:packageId/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicPackageItems);
router.post('/clinic/branches/:branchId/packages/:packageId/items/batch', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicPackageItemsBatch);
router.put('/clinic/branches/:branchId/packages/:packageId/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.upsertClinicPackageItem);
router.post('/clinic/branches/:branchId/packages/:packageId/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.upsertClinicPackageItem);
router.delete('/clinic/branches/:branchId/packages/:packageId/items/:itemId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicPackageItem);
router.get('/clinic/branches/:branchId/packages/:packageId/price-rules', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicPackagePriceRules);
router.post('/clinic/branches/:branchId/packages/:packageId/price-rules', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicPackagePriceRule);
router.delete('/clinic/branches/:branchId/packages/:packageId/price-rules/:ruleId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicPackagePriceRule);
router.get('/clinic/branches/:branchId/packages/:packageId/composition', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicPackageComposition);
router.get('/clinic/branches/:branchId/packages/:packageId/impact', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicPackageImpact);
router.get('/clinic/branches/:branchId/packages/:packageId/audit-log', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicPackageAuditLog);
router.post('/clinic/branches/:branchId/packages/:packageId/duplicate', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.duplicateClinicPackage);
router.get('/clinic/branches/:branchId/package-templates', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicPackageTemplates);
router.get('/clinic/branches/:branchId/package-templates/:templateId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicPackageTemplateById);
router.post('/clinic/branches/:branchId/package-templates', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicPackageTemplate);
router.patch('/clinic/branches/:branchId/package-templates/:templateId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicPackageTemplate);
router.delete('/clinic/branches/:branchId/package-templates/:templateId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicPackageTemplate);
// Clinical Item Master (catalog)
router.get('/clinic/branches/:branchId/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicItems);
router.get('/clinic/branches/:branchId/items/search', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.searchClinicItems);
router.get('/clinic/branches/:branchId/items/:itemId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicItemById);
router.post('/clinic/branches/:branchId/items', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicItem);
router.patch('/clinic/branches/:branchId/items/:itemId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicItem);
router.post('/clinic/branches/:branchId/items/:itemId/activate', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.activateClinicItem);
router.post('/clinic/branches/:branchId/items/:itemId/deactivate', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deactivateClinicItem);
router.post('/clinic/branches/:branchId/items/:itemId/variants', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicItemVariant);
router.patch('/clinic/branches/:branchId/items/:itemId/variants/:variantId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicItemVariant);
router.post('/clinic/branches/:branchId/items/:itemId/media', requireOwnerPermission('clinic.services.manage', 'branch'), upload.single('file'), clinicCtrl.uploadClinicItemMedia);
router.delete('/clinic/branches/:branchId/items/:itemId/media/:mediaId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicItemMedia);
router.get('/clinic/branches/:branchId/item-categories', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicItemCategories);
router.get('/clinic/branches/:branchId/item-categories/tree', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicItemCategoryTree);
router.post('/clinic/branches/:branchId/item-categories', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicItemCategory);
router.patch('/clinic/branches/:branchId/item-categories/:categoryId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.updateClinicItemCategory);
router.delete('/clinic/branches/:branchId/item-categories/:categoryId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.deleteClinicItemCategory);
router.get('/clinic/branches/:branchId/item-stock', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicBranchItemStock);
router.get('/clinic/branches/:branchId/item-stock/alerts', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicLowStockAlerts);
router.get('/clinic/branches/:branchId/item-stock/ledger', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicItemStockLedger);
router.get('/clinic/branches/:branchId/item-stock/consumption', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicItemStockConsumption);
router.post('/clinic/branches/:branchId/item-stock/adjust', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicItemStockAdjust);
router.post('/clinic/branches/:branchId/item-stock/receive', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicItemStockReceive);
router.get('/clinic/supply-requests', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.listClinicSupplyRequests);
router.get('/clinic/supply-requests/:requestId', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.getClinicSupplyRequestById);
router.put('/clinic/supply-requests/:requestId/review', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.reviewClinicSupplyRequest);
router.post('/clinic/supply-requests/:requestId/mark-ordered', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.markClinicSupplyRequestOrdered);
router.post('/clinic/supply-requests/:requestId/mark-received', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.markClinicSupplyRequestReceived);
router.post('/clinic/supply-requests/:requestId/cancel', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.cancelClinicSupplyRequest);
router.post('/clinic/supply-requests/:requestId/transfer', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.createClinicTransferFromRequest);
router.get('/clinic/transfers', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.listClinicTransfers);
router.get('/clinic/transfers/:transferId', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.getClinicTransferById);
router.post('/clinic/transfers/:transferId/dispatch', requireOwnerPermission('clinic.services.manage', null), clinicCtrl.dispatchClinicTransfer);
router.get('/clinic/branches/:branchId/instrument-issues', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicInstrumentIssueLogs);
router.post('/clinic/branches/:branchId/instrument-issues', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.createClinicInstrumentIssueLog);
router.patch('/clinic/branches/:branchId/instrument-issues/:logId/return', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.returnClinicInstrumentIssueLog);
router.get('/clinic/branches/:branchId/sterilization/cycles', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicSterilizationCycles);
router.get('/clinic/branches/:branchId/sterilization/cycles/:cycleId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicSterilizationCycleById);
router.post('/clinic/branches/:branchId/sterilization/cycles', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicSterilizationCycleStart);
router.post('/clinic/branches/:branchId/sterilization/cycles/:cycleId/complete', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicSterilizationCycleComplete);
router.post('/clinic/branches/:branchId/sterilization/cycles/:cycleId/fail', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicSterilizationCycleFail);
router.get('/clinic/branches/:branchId/sterilization/instruments', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicInstrumentInstances);
router.get('/clinic/branches/:branchId/sterilization/instruments/due', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicSterilizationDueAlerts);
router.get('/clinic/branches/:branchId/audits', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicStockAudits);
router.get('/clinic/branches/:branchId/audits/:auditId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicStockAuditById);
router.post('/clinic/branches/:branchId/audits/:auditId/approve', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicStockAuditApprove);
router.get('/clinic/branches/:branchId/wastage', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicWastageLogs);
router.get('/clinic/branches/:branchId/wastage/:wastageId', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.getClinicWastageLogById);
router.post('/clinic/branches/:branchId/wastage/:wastageId/approve', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicWastageApprove);
router.get('/clinic/branches/:branchId/replenishment', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.listClinicReplenishmentRecommendations);
router.post('/clinic/branches/:branchId/replenishment/generate', requireOwnerPermission('clinic.services.manage', 'branch'), clinicCtrl.postClinicReplenishmentGenerate);
// Clinic Enterprise: Discount policies
router.get('/clinic/branches/:branchId/discount-policies', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.listClinicDiscountPolicies);
router.get('/clinic/branches/:branchId/discount-policies/:policyId', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.getClinicDiscountPolicyById);
router.post('/clinic/branches/:branchId/discount-policies', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.createClinicDiscountPolicy);
router.patch('/clinic/branches/:branchId/discount-policies/:policyId', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.updateClinicDiscountPolicy);
router.get('/clinic/branches/:branchId/discount-approval-rules', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.getClinicDiscountApprovalRules);
router.put('/clinic/branches/:branchId/discount-approval-rules', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.upsertClinicDiscountApprovalRule);
router.get('/clinic/branches/:branchId/discount-audit', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.getClinicDiscountAuditLog);
// Clinic Enterprise: Doctor contracts
router.get('/clinic/branches/:branchId/doctors/:memberId/contract', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorContract);
router.get('/clinic/branches/:branchId/doctors/:memberId/contracts', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listClinicDoctorContracts);
router.post('/clinic/branches/:branchId/doctors/:memberId/contract', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.createClinicDoctorContract);
router.patch('/clinic/branches/:branchId/doctors/:memberId/contract/:contractId', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.updateClinicDoctorContract);
router.get('/clinic/branches/:branchId/doctors/:memberId/contract/rate-preview', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorContractRatePreview);
// Clinic Enterprise: Settlement batches
router.post('/clinic/branches/:branchId/settlement-batches/generate', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.generateClinicSettlementBatches);
router.get('/clinic/branches/:branchId/settlement-batches', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.listClinicSettlementBatches);
router.get('/clinic/branches/:branchId/settlement-batches/:batchId', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicSettlementBatchById);
router.put('/clinic/branches/:branchId/settlement-batches/:batchId/review', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.reviewClinicSettlementBatch);
router.put('/clinic/branches/:branchId/settlement-batches/:batchId/approve', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.approveClinicSettlementBatch);
router.post('/clinic/branches/:branchId/settlement-batches/:batchId/pay', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.payClinicSettlementBatch);
router.post('/clinic/branches/:branchId/settlement-batches/:batchId/adjustments', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.addClinicSettlementBatchAdjustment);
router.get('/clinic/branches/:branchId/doctors/:memberId/settlement-summary', requireOwnerPermission('clinic.staff.manage', 'branch'), clinicCtrl.getClinicDoctorSettlementSummary);
// Clinic Enterprise: Reports
router.get('/clinic/branches/:branchId/reports/profitability', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicProfitabilityReport);
router.get('/clinic/branches/:branchId/reports/settlement-summary', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicSettlementSummaryReport);
router.get('/clinic/branches/:branchId/reports/discount-analysis', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicDiscountAnalysisReport);
router.get('/clinic/branches/:branchId/reports/inventory-variance', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicInventoryVarianceReport);
router.get('/clinic/branches/:branchId/reports/doctor-contribution', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicDoctorContributionReport);
// Clinic Enterprise: Finance config
router.get('/clinic/branches/:branchId/finance-config', requireOwnerPermission('clinic.settings.read', 'branch'), clinicCtrl.getClinicFinanceConfig);
router.put('/clinic/branches/:branchId/finance-config', requireOwnerPermission('clinic.settings.write', 'branch'), clinicCtrl.updateClinicFinanceConfig);
// Schedule proposals (CP3A)
router.get('/clinic/branches/:branchId/schedule-proposals', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.listClinicScheduleProposals);
router.post('/clinic/branches/:branchId/schedule-proposals/:proposalId/review', requireOwnerPermission('clinic.schedule.manage', 'branch'), clinicCtrl.reviewClinicScheduleProposal);

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
router.patch('/staffs/:id/enable', ctrl.enableStaff);
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

// Staff invitations (Owner list / approve / reject / resend / cancel)
router.get('/invitations', ctrl.listOwnerInvitations);
router.post('/invitations/:id/approve', ctrl.approveOwnerInvitation);
router.post('/invitations/:id/reject', ctrl.rejectOwnerInvitation);
router.post('/invitations/:id/resend', ctrl.resendOwnerInvitation);
router.post('/invitations/:id/cancel', ctrl.cancelOwnerInvitation);

router.get('/staff-access/staff', ctrl.listOwnerStaffAccess);
router.get('/staff-access/staff/:userId/branch-access', ctrl.getOwnerStaffBranchAccess);

router.get('/notifications', ctrl.listOwnerNotifications);
router.post('/notifications/:id/read', ctrl.markOwnerNotificationRead);

// Branch Managers control (Owner-only: monitor, control, audit)
const bmCtrl = require('./ownerBranchManagers.controller');
router.get('/branch-managers', bmCtrl.list);
router.get('/branch-managers/:id', bmCtrl.getOne);
router.patch('/branch-managers/:id/status', bmCtrl.updateStatus);
router.patch('/branch-managers/:id/permissions', bmCtrl.updatePermissions);
router.post('/branch-managers/:id/force-logout', bmCtrl.forceLogout);
router.get('/branch-managers/:id/audit-logs', bmCtrl.getAuditLogs);
router.get('/branch-managers/:id/performance', bmCtrl.getPerformance);

// Staff Control Dashboard (Owner-only: monitor, control, audit staff; :id = userId)
const staffCtrl = require('./ownerStaffControl.controller');
router.get('/staff', staffCtrl.list);
router.get('/staff/:id', staffCtrl.getOne);
router.patch('/staff/:id/status', staffCtrl.updateStatus);
router.patch('/staff/:id/role', staffCtrl.updateRole);
router.patch('/staff/:id/permissions', staffCtrl.updatePermissions);
router.patch('/staff/:id/shift-rules', staffCtrl.updateShiftRules);
router.post('/staff/:id/force-logout', staffCtrl.forceLogout);
router.post('/staff/:id/transfer-branch', staffCtrl.transferBranch);
router.get('/staff/:id/audit-logs', staffCtrl.getAuditLogs);
router.get('/staff/:id/activity-summary', staffCtrl.getActivitySummary);

// Hubs (ONLINE_HUB locations for order fulfilment filter)
router.get('/hubs', ctrl.getHubs);

// Central Warehouse (resolve or designate)
router.get('/central-warehouse', ctrl.getCentralWarehouse);
router.post('/central-warehouse', ctrl.postCentralWarehouse);

// Inventory locations: idempotent ensure default location per branch (for receipts dropdown)
router.post('/inventory/locations/ensure-defaults', ctrl.ensureDefaultInventoryLocations);
router.post('/inventory/locations', ctrl.createInventoryLocation);
router.patch('/inventory/locations/:id', ctrl.updateInventoryLocation);
router.delete('/inventory/locations/:id', ctrl.deleteInventoryLocation);

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

// Universal Product Import (Owner panel) – rate limit upload, all enforce org/branch scope
const productImportUploadLimiter = require('../../../../middleware/rateLimiters').productImportUploadLimiter;
const productImportCtrl = require('./productImport.controller');
router.get('/imports/products', productImportCtrl.listImportBatches);
router.post('/imports/products/upload', productImportUploadLimiter, upload.single('file'), productImportCtrl.uploadProductImport);
router.get('/imports/products/:batchId', productImportCtrl.getImportBatch);
router.get('/imports/products/:batchId/insights', productImportCtrl.getImportBatchInsights);
router.get('/imports/products/:batchId/rows', productImportCtrl.getImportBatchRows);
router.get('/imports/products/:batchId/unmapped', productImportCtrl.getUnmappedValues);
router.post('/imports/products/:batchId/revalidate', productImportCtrl.revalidateImportBatch);
router.post('/imports/products/:batchId/bulk-fix', productImportCtrl.bulkFixImportBatch);
router.post('/imports/mappings', productImportCtrl.upsertImportMapping);
router.get('/imports/mappings', productImportCtrl.listImportMappings);
router.post('/imports/products/:batchId/publish', requireOwnerKycVerified, productImportCtrl.publishImportBatch);
router.post('/imports/products/unpublish', productImportCtrl.unpublishImportProduct);
router.post('/imports/products/rows/:rowId/fix', productImportCtrl.fixImportRow);

// Owner Delegation & Team Management
// Team dashboard routes: require owner context + TEAM_MANAGE (team owners only; no redirect to KYC)
const delegationCtrl = require('./ownerDelegation.controller');
router.get('/team/overview', ...teamDashboardGuard, delegationCtrl.getTeamOverview);
router.get('/team/members', ...teamDashboardGuard, delegationCtrl.listTeamMembers);
router.get('/team/invitations', ...teamDashboardGuard, delegationCtrl.listTeamDashboardInvitations);
router.post('/team/invitations/:id/resend', ...teamDashboardGuard, delegationCtrl.resendTeamInvitationHandler);
router.post('/team/invitations/:id/cancel', ...teamDashboardGuard, delegationCtrl.cancelTeamInvitationHandler);
router.get('/teams', ...teamDashboardGuard, delegationCtrl.listTeams);
router.post('/teams', ...teamDashboardGuard, delegationCtrl.createTeam);
router.post('/teams/:teamId/invite', ...teamDashboardGuard, delegationCtrl.inviteToTeam);
router.get('/teams/:teamId/invitations', ...teamDashboardGuard, delegationCtrl.listInvitations);
router.post('/teams/:teamId/members', ...teamDashboardGuard, delegationCtrl.addMember);
router.delete('/teams/:teamId/members/:userId', ...teamDashboardGuard, delegationCtrl.removeMember);
router.get('/delegations/scopes', delegationCtrl.listScopes);
router.post('/delegations', delegationCtrl.assign);
router.post('/delegations/revoke', delegationCtrl.revoke);
router.post('/delegations/revoke-all', delegationCtrl.revokeAll);
router.post('/delegations/set-team', delegationCtrl.setTeam);
router.get('/overview', delegationCtrl.getOverview);
router.get('/overview/logs', delegationCtrl.getOverviewLogs);

const onboardingCtrl = require('./onboarding.controller');
router.get('/onboarding/status', onboardingCtrl.getOnboardingStatus);
router.post('/onboarding/start', ensureOwnerKyc, onboardingCtrl.startOnboarding);

// Branch Manager Control: policy and escalations (owner only)
const ownerPolicyCtrl = require('./ownerPolicy.controller');
router.get('/branch-policy/:branchId', requireOwnerPermission('branch.write', 'branch'), ownerPolicyCtrl.getBranchPolicyHandler);
router.put('/branch-policy/:branchId', requireOwnerPermission('branch.write', 'branch'), ownerPolicyCtrl.updateBranchPolicyHandler);
router.get('/escalations', ownerPolicyCtrl.listEscalationsHandler);
router.put('/escalations/:id/decide', ownerPolicyCtrl.decideEscalationHandler);
router.get('/manager-activity/:branchId', requireOwnerPermission('branch.read', 'branch'), ownerPolicyCtrl.getManagerActivityHandler);

// Clinic Approval Workflow: Owner Approval Center
router.get('/approval-requests', ownerPolicyCtrl.listClinicApprovalRequestsHandler);
router.get('/approval-requests/:id', ownerPolicyCtrl.getClinicApprovalRequestByIdHandler);
router.put('/approval-requests/:id/decide', ownerPolicyCtrl.decideClinicApprovalRequestHandler);

module.exports = router;

export {};
