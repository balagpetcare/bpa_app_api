const router = require('express').Router();
const ctrl = require('./locations.controller');

// --- Dhaka fast tree (DNCC/DSCC -> Area) ---
router.get('/city-corporations', ctrl.listCityCorporations);
router.get('/areas', ctrl.searchAreas);

// --- National BD hierarchy (Division -> District -> Upazila -> Area) ---
router.get('/divisions', ctrl.listDivisions);
router.get('/districts', ctrl.listDistricts);
router.get('/upazilas', ctrl.listUpazilas);
router.get('/bd-areas', ctrl.listBdAreas);

// Unified search + resolve (supports both Dhaka tree and BD hierarchy)
router.get('/search', ctrl.searchLocations);
router.get('/resolve', ctrl.resolveLocation);

module.exports = router;

export {};
