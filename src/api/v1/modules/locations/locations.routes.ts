const router = require('express').Router();
const ctrl = require('./locations.controller');
const { geocodeLimiter } = require('../../../../middleware/rateLimiters');
const auth = require('../../../../middleware/auth.middleware');
const requirePermission = require('../../../../middlewares/requirePermission');
const { LOCATION_PERMISSIONS } = require('../../../../modules/location/location.permissions');

router.get('/countries', ctrl.listCountries);

// --- Dhaka fast tree (DNCC/DSCC -> Area) ---
router.get('/city-corporations', ctrl.listCityCorporations);
router.get('/areas', ctrl.searchAreas);

// --- National BD hierarchy (Division -> District -> Upazila -> Area) ---
router.get('/divisions', ctrl.listDivisions);
router.get('/districts', ctrl.listDistricts);
router.get('/upazilas', ctrl.listUpazilas);
router.get('/unions', ctrl.listUnions);
router.get('/bd-areas', ctrl.listBdAreas);

// Unified search + resolve (supports both Dhaka tree and BD hierarchy)
router.get('/search', ctrl.searchLocations);
router.get('/resolve', ctrl.resolveLocation);
router.post('/validate-selection', ctrl.validateSelection);

// Coverage APIs (centralized location references)
router.get('/coverage/:entityType/:entityId', auth, requirePermission(LOCATION_PERMISSIONS.COVERAGE_READ), ctrl.listCoverage);
router.put('/coverage/:entityType/:entityId', auth, requirePermission(LOCATION_PERMISSIONS.COVERAGE_MANAGE), ctrl.replaceCoverage);

// Nearby branches (radius-based)
router.get('/nearby', ctrl.getNearby);

// Geocoding endpoints (Nominatim/OpenStreetMap) — Phase 3: GET + rate limit
router.get('/geocode', geocodeLimiter, (req, res, next) => {
  req.body = { query: req.query.q };
  ctrl.geocode(req, res, next);
});
router.get('/reverse', geocodeLimiter, (req, res, next) => {
  req.body = { latitude: req.query.lat, longitude: req.query.lng };
  ctrl.reverseGeocode(req, res, next);
});
router.post('/geocode', geocodeLimiter, ctrl.geocode);
router.post('/reverse-geocode', geocodeLimiter, ctrl.reverseGeocode);

module.exports = router;

export {};
