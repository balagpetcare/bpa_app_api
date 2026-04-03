const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./networkBalance.controller");

function requireNetPerm(...permissions: string[]) {
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

router.post(
  "/recompute",
  requireNetPerm("inventory.read", "org.read"),
  ctrl.postRecompute
);
router.get(
  "/recommendations",
  requireNetPerm("inventory.read", "org.read"),
  ctrl.getRecommendations
);
router.get(
  "/recommendations/:id",
  requireNetPerm("inventory.read", "org.read"),
  ctrl.getRecommendationById
);
router.post(
  "/recommendations/:id/dismiss",
  requireNetPerm("inventory.update", "org.write"),
  ctrl.postDismiss
);
router.post(
  "/recommendations/:id/accept",
  requireNetPerm("inventory.update", "org.write"),
  ctrl.postAccept
);
router.get(
  "/snapshots/latest",
  requireNetPerm("inventory.read", "org.read"),
  ctrl.getLatestSnapshot
);
router.get("/routes", requireNetPerm("inventory.read", "org.read"), ctrl.getRoutes);

module.exports = router;
