const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./commandCenter.controller");

function requireCcPermission(...permissions: string[]) {
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
  "/exceptions",
  requireCcPermission("operations.command_center.read", "inventory.read", "org.read"),
  ctrl.listExceptions
);
router.get(
  "/exceptions/:id",
  requireCcPermission("operations.command_center.read", "inventory.read", "org.read"),
  ctrl.getException
);
router.patch(
  "/exceptions/:id",
  requireCcPermission("operations.command_center.manage", "operations.command_center.read", "org.write"),
  ctrl.patchException
);
router.post(
  "/exceptions/:id/rca",
  requireCcPermission("operations.command_center.manage", "operations.command_center.read", "org.write"),
  ctrl.postRca
);
router.post(
  "/refresh",
  requireCcPermission("operations.command_center.manage", "operations.command_center.read", "inventory.read"),
  ctrl.postRefreshExceptions
);

module.exports = router;
