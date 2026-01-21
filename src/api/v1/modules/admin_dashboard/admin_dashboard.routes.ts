const router = require('express').Router();
const authenticateToken = require('../../../../middleware/auth.middleware');
const adminOnly = require('../../../../middleware/admin.middleware');
const ctrl = require('./admin_dashboard.controller');

// Summary widgets for the admin panel dashboard
router.get('/summary', authenticateToken, adminOnly, ctrl.getSummary);

// Small action queues for "My Review Queue" widgets
router.get('/queues', authenticateToken, adminOnly, ctrl.getQueues);

module.exports = router;

export {};
