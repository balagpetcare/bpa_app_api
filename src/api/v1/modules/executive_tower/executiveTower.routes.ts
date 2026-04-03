const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./executiveTower.controller");

router.use(authenticateToken);

router.get("/overview", ctrl.getOverview);
router.get("/kpis", ctrl.getKpis);
router.get("/drilldown", ctrl.getDrilldown);

router.get("/decision-packages", ctrl.getDecisionPackages);
router.post("/decision-packages/synthesize", ctrl.postSynthesizeDecisionPackage);
router.get("/decision-packages/:id", ctrl.getDecisionPackage);
router.post("/decision-packages/:id/approve", ctrl.postApprovePackage);
router.post("/decision-packages/:id/reject", ctrl.postRejectPackage);
router.post("/decision-packages/:id/override", ctrl.postOverridePackage);

router.get("/scenarios", ctrl.getScenarios);
router.get("/scenarios/:runId", ctrl.getScenario);
router.post("/scenarios", ctrl.postScenario);
router.get("/scenario-templates", ctrl.getScenarioTemplates);

module.exports = router;
