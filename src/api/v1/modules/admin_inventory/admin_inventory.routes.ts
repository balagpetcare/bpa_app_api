const router = require('express').Router();
const authenticateToken = require('../../../../middleware/auth.middleware');
const adminOnly = require('../../../../middleware/admin.middleware');
const ctrl = require('./admin_inventory.controller');

router.get('/summary', authenticateToken, adminOnly, ctrl.getSummary);
router.get('/alerts', authenticateToken, adminOnly, ctrl.getAlerts);

module.exports = router;

export {};
