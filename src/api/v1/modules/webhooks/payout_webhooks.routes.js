const router = require('express').Router();
const ctrl = require('./payout_webhooks.controller');
const { webhookLimiter } = require('../../../../middleware/rateLimiters');

// Provider webhooks
router.post('/bkash', webhookLimiter, ctrl.bkash);
router.post('/nagad', webhookLimiter, ctrl.nagad);
router.post('/rocket', webhookLimiter, ctrl.rocket);

module.exports = router;
