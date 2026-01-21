const router = require('express').Router();
const auth = require('../../../middlewares/auth');
const roleGuard = require('../../../middlewares/roleGuard');
const ctrl = require('./admin.controller');

router.use(auth, roleGuard(['ADMIN', 'SUPER_ADMIN']));

router.get('/review', ctrl.listReviewQueue);
router.get('/review/:entityType/:id', ctrl.getReviewItem);
router.post('/review/:entityType/:id/approve', ctrl.approveItem);
router.post('/review/:entityType/:id/reject', ctrl.rejectItem);
router.post('/review/:entityType/:id/suspend', ctrl.suspendItem);
router.post('/review/:entityType/:id/reinstate', ctrl.reinstateItem);

router.post('/review/bulk-approve', ctrl.bulkApprove);
router.post('/review/bulk-reject', ctrl.bulkReject);

// V3.4: Monitoring (soft-mode compatible)
router.get('/verification-metrics/locked-update-attempts', ctrl.listLockedUpdateAttempts);

// V3.5: Monitoring dashboard endpoints
router.get('/verification-metrics/summary', ctrl.getLockedUpdateAttemptsSummary);
router.get('/verification-metrics/timeseries', ctrl.getLockedUpdateAttemptsTimeseries);
router.get('/verification-metrics/top-entities', ctrl.getLockedUpdateAttemptsTopEntities);

module.exports = router;

export {};
