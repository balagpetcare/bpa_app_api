const router = require('express').Router();
const authenticateToken = require('../../../../middleware/auth.middleware');
const adminOnly = require('../../../../middleware/admin.middleware');
const ctrl = require('./admin_dashboard.controller');

// Summary widgets for the admin panel dashboard
router.get('/summary', authenticateToken, adminOnly, ctrl.getSummary);

// Small action queues for "My Review Queue" widgets
router.get('/queues', authenticateToken, adminOnly, ctrl.getQueues);

// Analytics endpoints
router.get('/analytics', authenticateToken, adminOnly, ctrl.getAnalytics);
router.get('/revenue', authenticateToken, adminOnly, ctrl.getRevenue);
router.get('/activity', authenticateToken, adminOnly, ctrl.getActivity);

// Live monitor, alerts, SLA, trends
router.get('/live-feed', authenticateToken, adminOnly, ctrl.getLiveFeed);
router.get('/alerts', authenticateToken, adminOnly, ctrl.getAlerts);
router.get('/sla', authenticateToken, adminOnly, ctrl.getSla);
router.get('/trends', authenticateToken, adminOnly, ctrl.getTrends);

module.exports = router;

export {};
