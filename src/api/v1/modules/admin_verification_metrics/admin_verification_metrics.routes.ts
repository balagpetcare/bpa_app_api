const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const ctrl = require("../admin/admin.controller");

router.use(authenticateToken, adminOnly);

router.get("/summary", ctrl.getLockedUpdateAttemptsSummary);
router.get("/timeseries", ctrl.getLockedUpdateAttemptsTimeseries);
router.get("/top-entities", ctrl.getLockedUpdateAttemptsTopEntities);
router.get("/locked-update-attempts", ctrl.listLockedUpdateAttempts);

module.exports = router;

export {};
