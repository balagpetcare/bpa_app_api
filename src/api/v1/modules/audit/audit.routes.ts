const router = require('express').Router();
const auth = require('../../../middlewares/auth');
const roleGuard = require('../../../middlewares/roleGuard');
const ctrl = require('./audit.controller');

router.use(auth, roleGuard(['ADMIN', 'SUPER_ADMIN']));
router.get('/', ctrl.queryAudit);

module.exports = router;

export {};
