const router = require('express').Router();

const auth = require('../../../../middleware/auth.middleware');
const admin = require('../../../../middleware/adminMiddleware');
const admin2fa = require('../../../../middleware/admin2fa.middleware');
const { withdrawLimiter } = require('../../../../middleware/rateLimiters');
const requireOwnerKycVerified = require('../../../../middlewares/requireOwnerKycVerified');

const ctrl = require('./wallet.controller');

// --------------------
// User Wallet (V1/V2)
// --------------------
router.get('/me', auth, ctrl.me);
router.get('/transactions', auth, ctrl.transactions);

// --------------------
// User Withdraw (V2/V3)
// --------------------
router.post('/withdraw/requests', auth, requireOwnerKycVerified, withdrawLimiter, ctrl.createWithdrawRequest);
router.get('/withdraw/requests', auth, ctrl.listMyWithdrawRequests);
router.get('/withdraw/requests/:id', auth, ctrl.getMyWithdrawRequest);
router.patch('/withdraw/requests/:id/cancel', auth, withdrawLimiter, ctrl.cancelWithdrawRequest);

// --------------------
// Admin Withdraw (V2/V3)
// --------------------
router.get('/admin/withdraw/requests', auth, admin, ctrl.adminListWithdrawRequests);
router.patch('/admin/withdraw/requests/:id/status', auth, admin, admin2fa, ctrl.adminUpdateWithdrawStatus);

// Session-3 actions
router.patch('/admin/withdraw/requests/:id/approve', auth, admin, admin2fa, ctrl.adminApproveAndQueue);
router.post('/admin/withdraw/requests/:id/pay-now', auth, admin, admin2fa, ctrl.adminPayNow); // semi-auto trigger
router.post('/admin/withdraw/requests/:id/retry', auth, admin, admin2fa, ctrl.adminRetryPayout);

// Worker helper (run one cycle manually)
router.post('/admin/payout/run', auth, admin, admin2fa, ctrl.adminRunPayoutWorkerOnce);

module.exports = router;

export {};
