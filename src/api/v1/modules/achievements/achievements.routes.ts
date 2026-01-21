const router = require('express').Router();
const auth = require('../../../../middleware/auth.middleware');
const admin = require('../../../../middleware/adminMiddleware');
const ctrl = require('./achievements.controller');

// GET /api/v1/achievements
router.get('/', auth, ctrl.listAchievements);

// Admin CRUD
router.post('/', auth, admin, ctrl.createAchievement);
router.put('/:id', auth, admin, ctrl.updateAchievement);
router.patch('/:id', auth, admin, ctrl.updateAchievement);
router.delete('/:id', auth, admin, ctrl.deleteAchievement);

module.exports = router;

export {};
