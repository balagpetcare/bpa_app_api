const router = require("express").Router();
const controller = require("./pricing.controller");
const gov = require("./pricingGovernance.controller");
const retail = require("./retailDiscount.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");
const requirePermission = require("../../../../middlewares/requirePermission");

// All routes require authentication
router.use(authenticateToken);

// POST /api/v1/pricing - Set location price
router.post("/", requirePermission("inventory.update", "org.write"), controller.setPrice);

// GET /api/v1/pricing - Get location price
router.get("/", requirePermission("product.read", "org.read"), controller.getPrice);

// GET /api/v1/pricing/resolve - Resolve selling price
router.get("/resolve", requirePermission("product.read", "org.read"), controller.resolvePrice);

// GET /api/v1/pricing/org - List org-level product pricings
router.get("/org", requirePermission("org.read", "product.read"), controller.listOrgPricing);

// POST /api/v1/pricing/org - Set org-level product pricing
router.post("/org", requirePermission("pricing.central.write"), controller.setOrgPricing);

// GET /api/v1/pricing/branch - List branch pricing overrides
router.get("/branch", requirePermission("branch.read", "org.read"), controller.listBranchPricing);

// POST /api/v1/pricing/branch - Set branch pricing override
router.post("/branch", requirePermission("pricing.branch.override"), controller.setBranchPricing);

// --- Pricing governance (Phase 3+) ---
router.get("/governance/policy", requirePermission("pricing.audit.view", "org.read"), gov.getPolicy);
router.patch("/governance/policy", requirePermission("pricing.central.write"), gov.patchPolicy);
router.get("/governance/audit", requirePermission("pricing.audit.view", "org.read"), gov.listAudit);

router.get(
  "/retail-discount/rules",
  requirePermission("pricing.retail.rule.manage", "pricing.audit.view", "org.read"),
  retail.listRules
);
router.post("/retail-discount/rules", requirePermission("pricing.retail.rule.manage"), retail.upsertRule);
router.post(
  "/retail-discount/validate",
  requirePermission("retail.discount.apply", "orders.read", "orders.write", "pos.view"),
  retail.validateLine
);
router.get(
  "/retail-discount/approvals",
  requirePermission("retail.discount.approve", "pricing.retail.rule.manage"),
  retail.listApprovals
);
router.post(
  "/retail-discount/approvals",
  requirePermission("retail.discount.apply", "pos.view", "orders.write"),
  retail.submitApproval
);
router.patch(
  "/retail-discount/approvals/:id(\\d+)",
  requirePermission("retail.discount.approve"),
  retail.reviewApproval
);

module.exports = router;

export {};
