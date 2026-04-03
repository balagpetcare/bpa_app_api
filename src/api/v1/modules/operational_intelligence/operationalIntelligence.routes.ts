const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./operationalIntelligence.controller");

function requireIntelPermission(...permissions: string[]) {
  return (req: any, res: any, next: any) => {
    const userPerms = req.user?.permissions || [];
    const ok = permissions.some((p) => userPerms.includes(p));
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: "Permission denied",
        code: "MISSING_PERMISSION",
        requiredPermissions: permissions,
      });
    }
    next();
  };
}

router.use(authenticateToken);

router.get(
  "/financial/summary",
  requireIntelPermission("inventory.financial.read", "inventory.read", "org.read"),
  ctrl.getFinancialSummary
);
router.get(
  "/financial/cts",
  requireIntelPermission("inventory.financial.read", "inventory.read", "org.read"),
  ctrl.getCts
);
router.get(
  "/financial/cost-facts",
  requireIntelPermission("inventory.financial.read", "inventory.read", "org.read"),
  ctrl.getCostFacts
);
router.post(
  "/financial/refresh",
  requireIntelPermission("inventory.financial.read", "inventory.read", "org.read"),
  ctrl.postFinancialRefresh
);

router.get(
  "/slo/definitions",
  requireIntelPermission("inventory.slo.read", "inventory.ai.control_tower.read", "org.read"),
  ctrl.getSloDefinitions
);
router.get(
  "/slo/measurements",
  requireIntelPermission("inventory.slo.read", "inventory.ai.control_tower.read", "org.read"),
  ctrl.getSloMeasurements
);
router.put(
  "/slo/definitions/:id",
  requireIntelPermission("inventory.slo.read", "org.write"),
  ctrl.putSloDefinition
);

module.exports = router;
