const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const ctrl = require("./reverseLogistics.controller");

function requireInv(...permissions: string[]) {
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

router.post("/stock-returns", requireInv("inventory.update", "org.write"), ctrl.postStockReturn);
router.get("/stock-returns", requireInv("inventory.read", "org.read"), ctrl.getStockReturns);
router.get("/stock-returns/:id", requireInv("inventory.read", "org.read"), ctrl.getStockReturn);
router.post("/stock-returns/:id/receive", requireInv("inventory.update", "org.write"), ctrl.postReceive);
router.patch("/stock-returns/:id/disposition", requireInv("inventory.update", "org.write"), ctrl.patchDisposition);
router.post("/stock-returns/:id/dispute", requireInv("inventory.update", "org.write"), ctrl.postDispute);

router.get("/cases", requireInv("inventory.read", "org.read"), ctrl.getCases);
router.post("/cases", requireInv("inventory.update", "org.write"), ctrl.postCase);

module.exports = router;
