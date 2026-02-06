const router = require('express').Router();

const auth = require('../../../../middleware/auth.middleware');
const admin = require('../../../../middleware/adminMiddleware');
const admin2fa = require('../../../../middleware/admin2fa.middleware');
const { requireFeature } = require('../../middlewares/requireFeature');
const { policyGuard } = require('../../middlewares/policyGuard');
const { donationLimiter } = require('../../../../middleware/rateLimiters');
const ctrl = require('./fundraising.controller');

// ------------------------------
// Feed & Campaign CRUD
// ------------------------------
router.get('/feed', auth, ctrl.getFeed);
router.get('/campaigns/:id', auth, ctrl.getCampaign);
router.get('/campaigns/:id/single', auth, ctrl.getCampaignSingle);
router.post('/campaigns', auth, requireFeature('FUNDRAISING'), ctrl.createCampaign);
router.patch('/campaigns/:id', auth, requireFeature('FUNDRAISING'), ctrl.updateCampaign);
router.delete('/campaigns/:id', auth, requireFeature('FUNDRAISING'), ctrl.deleteCampaign);

// ------------------------------
// Donations & Updates
// ------------------------------
router.post(
  '/campaigns/:id/donate',
  donationLimiter,
  auth,
  requireFeature('DONATION'),
  policyGuard('donation.max_per_tx', { valueGetter: (req) => req.body?.amount }),
  ctrl.donate
);

router.get('/campaigns/:id/donations', auth, ctrl.listDonations);

router.get('/campaigns/:id/updates', auth, ctrl.listUpdates);
router.post('/campaigns/:id/updates', auth, ctrl.createUpdate);
router.patch('/updates/:id', auth, ctrl.updateUpdate);
router.delete('/updates/:id', auth, ctrl.deleteUpdate);

// ------------------------------
// Fundraising Account (creator verification)
// ------------------------------
// NOTE: Flutter client expects `/account/me`.
// Keep `/account` for backward compatibility and add `/account/me` as an alias.
router.get('/account', auth, ctrl.getMyAccount);
router.get('/account/me', auth, ctrl.getMyAccount);
router.patch('/account', auth, ctrl.updateMyAccount);

router.post('/account/documents', auth, ctrl.addVerificationDocument);
router.delete('/account/documents/:id', auth, ctrl.deleteVerificationDocument);
router.post('/account/submit', auth, ctrl.submitAccount);

// ------------------------------
// Admin review
// ------------------------------
// Phase 2.6: Donation hold/KYC list + approve/reject
router.get('/admin/donations/hold', auth, admin, ctrl.adminListDonationsHold);
router.patch('/admin/donations/:id/status', auth, admin, admin2fa, ctrl.adminUpdateDonationStatus);

router.get('/admin/accounts', auth, admin, ctrl.adminListAccounts);
router.patch('/admin/accounts/:id/status', auth, admin, admin2fa, ctrl.adminUpdateAccountStatus);

// ------------------------------
// Payout methods & Withdrawals (Phase C)
// ------------------------------
router.get('/payout/catalog', auth, ctrl.listPayoutCatalog);

// ✅ Unified withdraw UI needs a simple way to list only the current user's campaigns.
router.get('/my/campaigns', auth, ctrl.listMyCampaigns);

router.get('/payout/methods', auth, ctrl.listMyPayoutMethods);
router.post('/payout/methods', auth, ctrl.createMyPayoutMethod);
router.patch('/payout/methods/:id', auth, ctrl.updateMyPayoutMethod);
router.delete('/payout/methods/:id', auth, ctrl.deleteMyPayoutMethod);

router.get('/withdraw/requests', auth, ctrl.listMyWithdrawRequests);
router.post('/campaigns/:id/withdraw', auth, ctrl.createWithdrawRequest);

// Admin
router.get('/admin/withdraw/requests', auth, admin, ctrl.adminListWithdrawRequests);
router.patch('/admin/withdraw/requests/:id/status', auth, admin, admin2fa, ctrl.adminUpdateWithdrawRequestStatus);

module.exports = router;

export {};
