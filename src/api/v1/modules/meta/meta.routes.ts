const router = require('express').Router();
const ctl = require('./meta.controller');

// Public master data (dropdowns)
router.get('/branch-types', ctl.listBranchTypes);
router.get('/organization-types', ctl.listOrganizationTypes);

module.exports = router;

export {};
