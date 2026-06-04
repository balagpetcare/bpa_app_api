const router = require("express").Router();
const ctrl = require("./location.controller");
const auth = require("../../middleware/auth.middleware");
const requirePermission = require("../../middlewares/requirePermission");
const { LOCATION_PERMISSIONS } = require("./location.permissions");

router.get("/divisions", ctrl.listDivisions);
router.get("/districts", ctrl.listDistricts);
router.get("/upazilas", ctrl.listUpazilas);
router.get("/unions", ctrl.listUnions);
router.get("/areas", ctrl.listAreas);
router.get("/search", ctrl.search);
router.post("/validate-selection", ctrl.validateSelection);

router.get("/coverage/:entityType/:entityId", auth, requirePermission(LOCATION_PERMISSIONS.COVERAGE_READ), ctrl.listCoverage);
router.put("/coverage/:entityType/:entityId", auth, requirePermission(LOCATION_PERMISSIONS.COVERAGE_MANAGE), ctrl.replaceCoverage);

module.exports = router;
