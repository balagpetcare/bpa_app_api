const router = require('express').Router();

const auth = require('../../../../middleware/auth.middleware');
const ctrl = require('./fundraising.controller');

// Feed & details
router.get('/feed', auth, ctrl.getFeed);
router.get('/campaigns/:id', auth, ctrl.getCampaign);

// CRUD
router.post('/campaigns', auth, ctrl.createCampaign);
router.patch('/campaigns/:id', auth, ctrl.updateCampaign);
router.delete('/campaigns/:id', auth, ctrl.deleteCampaign);

// Donation (payment stub)
router.post('/campaigns/:id/donate', auth, ctrl.donate);

module.exports = router;
