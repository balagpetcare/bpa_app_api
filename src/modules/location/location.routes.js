
const router = require("express").Router();
const ctrl = require("./location.controller");

router.get("/dropdown", ctrl.dropdown);
router.get("/hierarchy", ctrl.hierarchy);
router.post("/admin/sync", ctrl.syncSeed);

module.exports = router;
