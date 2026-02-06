const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_state_policies.controller");

router.get("/states/:stateId/policies", authenticateToken, requireAdmin, ctrl.listByState);
router.post("/states/:stateId/policies", authenticateToken, requireAdmin, ctrl.create);
router.patch("/policies/:id", authenticateToken, requireAdmin, ctrl.update);
router.post("/policies/:id/activate", authenticateToken, requireAdmin, ctrl.activate);
router.put("/policies/:id/features", authenticateToken, requireAdmin, ctrl.replaceFeatures);
router.put("/policies/:id/rules", authenticateToken, requireAdmin, ctrl.replaceRules);

module.exports = router;
export {};

