/**
 * Admin Governance (Phase 3): reviewer stats, compliance, governance products.
 */

const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const requireAdmin = require("../../../../middleware/admin.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");
const governanceTrace = require("../../middlewares/governanceTrace.middleware");
const ctrl = require("./admin_governance.controller");

const manage = requirePermission("admin.approvals.manage");

router.use(governanceTrace);

router.get("/reviewer-stats", authenticateToken, requireAdmin, manage, ctrl.reviewerStats);
router.get("/compliance/product/:productId", authenticateToken, requireAdmin, manage, ctrl.productCompliance);

// Governance products (list/detail/actions)
router.get("/products", authenticateToken, requireAdmin, manage, ctrl.listGovernanceProducts);
router.get("/products/:id", authenticateToken, requireAdmin, manage, ctrl.getGovernanceProduct);
router.post("/products/:id/actions", authenticateToken, requireAdmin, manage, ctrl.actOnGovernanceProduct);

module.exports = router;
export {};
