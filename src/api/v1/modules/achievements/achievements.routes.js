const router = require('express').Router();
const auth = require('../../../../middleware/auth.middleware');
const ctrl = require('./achievements.controller');

// GET /api/v1/achievements
router.get('/', auth, ctrl.listAchievements);

module.exports = router;
