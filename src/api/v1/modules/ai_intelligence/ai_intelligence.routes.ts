const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./ai_intelligence.controller");

function requireAiPermission(...permissions: string[]) {
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
  "/forecast",
  requireAiPermission("inventory.ai.forecast.read", "inventory.read", "org.read"),
  ctrl.getForecast
);
router.get(
  "/demand-trend",
  requireAiPermission("inventory.ai.forecast.read", "inventory.read", "org.read"),
  ctrl.getDemandTrend
);
router.get(
  "/replenishment/suggestions",
  requireAiPermission("inventory.ai.replenishment.manage", "inventory.read", "org.read"),
  ctrl.getReplenishmentSuggestions
);
router.post(
  "/replenishment/suggestions/:id/accept",
  requireAiPermission("inventory.ai.replenishment.manage", "inventory.read", "org.read"),
  ctrl.postAcceptSuggestion
);
router.post(
  "/replenishment/suggestions/:id/dismiss",
  requireAiPermission("inventory.ai.replenishment.manage", "inventory.read", "org.read"),
  ctrl.postDismissSuggestion
);
router.post(
  "/replenishment/suggestions/bulk-dismiss",
  requireAiPermission("inventory.ai.replenishment.manage", "inventory.read", "org.read"),
  ctrl.postBulkDismissSuggestions
);
router.post(
  "/replenishment/suggestions/bulk-accept",
  requireAiPermission("inventory.ai.replenishment.manage", "inventory.read", "org.read"),
  ctrl.postBulkAcceptSuggestions
);
router.get(
  "/procurement/recommendations",
  requireAiPermission("inventory.ai.procurement.read", "inventory.read", "org.read"),
  ctrl.getProcurementRecommendations
);
router.get(
  "/procurement/price-history",
  requireAiPermission("inventory.ai.procurement.read", "inventory.read", "org.read"),
  ctrl.getProcurementPriceHistory
);
router.get(
  "/procurement/lead-time-history",
  requireAiPermission("inventory.ai.procurement.read", "inventory.read", "org.read"),
  ctrl.getProcurementLeadTimeHistory
);
router.get(
  "/control-tower/overview",
  requireAiPermission("inventory.ai.control_tower.read", "org.read"),
  ctrl.getControlTower
);
router.get(
  "/alerts",
  requireAiPermission("inventory.ai.control_tower.read", "inventory.ai.procurement.read", "org.read"),
  ctrl.getPlanningAlerts
);

module.exports = router;
