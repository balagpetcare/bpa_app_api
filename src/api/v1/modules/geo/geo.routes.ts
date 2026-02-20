const router = require('express').Router();
const ctrl = require('./geo.controller');
const { geocodeLimiter } = require('../../../../middleware/rateLimiters');

router.get('/countries', ctrl.listCountries);
router.get('/states', ctrl.listStates);
router.get('/cities', ctrl.listCities);
router.get('/search', geocodeLimiter, ctrl.searchGeo);
router.get('/reverse', geocodeLimiter, ctrl.reverseGeo);

module.exports = router;

export {};
