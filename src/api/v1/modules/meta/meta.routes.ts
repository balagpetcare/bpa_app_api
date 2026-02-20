const router = require('express').Router();
const ctl = require('./meta.controller');

// Public master data (dropdowns)
router.get('/branch-types', ctl.listBranchTypes);
router.get('/organization-types', ctl.listOrganizationTypes);
router.get('/categories', ctl.listCategories);
router.get('/brands', ctl.listBrands);

// Phase 5: Policy features for UI (hide/disable Donation, Ads per country)
router.get('/features', ctl.getFeatures);

// Country policy read-only (full policy for country, optional state override)
router.get('/policy', ctl.getPolicy);

module.exports = router;

export {};
