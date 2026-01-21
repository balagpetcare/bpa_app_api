const router = require('express').Router();
const authenticateToken = require('../../../../middleware/auth.middleware');
const adminOnly = require('../../../../middleware/admin.middleware');
const ctrl = require('./admin_audit.controller');

// Admin-only audit endpoints (diff scaffolding)
// GET /api/v1/admin/audit/logs?entityType=&entityId=&actorId=&q=&limit=
router.get('/logs', authenticateToken, adminOnly, ctrl.query);

// GET /api/v1/admin/audit/diff/:id
router.get('/diff/:id', authenticateToken, adminOnly, ctrl.diff);

module.exports = router;

export {};
