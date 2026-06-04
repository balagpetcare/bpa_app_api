const router = require("express").Router();
const controller = require("./pricing.controller");
const gov = require("./pricingGovernance.controller");
const retail = require("./retailDiscount.controller");
const ent = require("./enterprisePricing.controller");
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

// GET /api/v1/pricing/org/meta — category filter options (register before /org if paths overlap; Express matches in order)
router.get(
  "/org/meta",
  requirePermission("org.read", "product.read", "pricing.central.read"),
  controller.listOrgPricingMeta
);

// GET /api/v1/pricing/org - List org-level product pricings
router.get(
  "/org",
  requirePermission("org.read", "product.read", "pricing.central.read"),
  controller.listOrgPricing
);

// POST /api/v1/pricing/org/bulk — must be registered before POST /org
router.post(
  "/org/bulk",
  requirePermission("pricing.central.write", "pricing.bulk.import"),
  controller.bulkOrgPricing
);

// POST /api/v1/pricing/org - Set org-level product pricing
router.post("/org", requirePermission("pricing.central.write"), controller.setOrgPricing);

// GET /api/v1/pricing/branch - List branch pricing overrides
router.get("/branch", requirePermission("branch.read", "org.read"), controller.listBranchPricing);

// POST /api/v1/pricing/branch - Set branch pricing override
router.post("/branch", requirePermission("pricing.branch.override"), controller.setBranchPricing);

// --- Pricing governance (Phase 3+) ---
router.get(
  "/governance/policy",
  requirePermission("pricing.central.read", "pricing.audit.view", "org.read"),
  gov.getPolicy
);
router.patch("/governance/policy", requirePermission("pricing.central.write"), gov.patchPolicy);
router.get(
  "/governance/audit",
  requirePermission("pricing.central.read", "pricing.audit.view", "org.read"),
  gov.listAudit
);

router.get(
  "/retail-discount/rules",
  requirePermission("pricing.retail.rule.manage", "pricing.audit.view", "org.read"),
  retail.listRules
);
router.post("/retail-discount/rules", requirePermission("pricing.retail.rule.manage"), retail.upsertRule);
router.patch(
  "/retail-discount/rules/:id(\\d+)",
  requirePermission("pricing.retail.rule.manage"),
  retail.patchRule
);
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

// --- Enterprise pricing (phases 2–8) ---
router.get(
  "/enterprise-discount/rules",
  requirePermission("pricing.retail.rule.manage", "pricing.audit.view", "org.read", "pricing.central.read"),
  ent.listEnterpriseRules
);
router.post("/enterprise-discount/rules", requirePermission("pricing.retail.rule.manage"), ent.upsertEnterpriseRule);
router.patch(
  "/enterprise-discount/rules/:id(\\d+)",
  requirePermission("pricing.retail.rule.manage"),
  ent.patchEnterpriseRule
);

// GET /api/v1/pricing/membership/cards?orgId= — org discount cards for tier linkage UI (read + membership manage)
router.get("/membership/cards", requirePermission("pricing.membership.manage", "org.read"), ent.listMembershipCards);
router.get("/membership/tiers", requirePermission("pricing.membership.manage", "org.read"), ent.listTiers);
router.post("/membership/tiers", requirePermission("pricing.membership.manage"), ent.upsertTier);
router.post("/membership/tiers/exclusions", requirePermission("pricing.membership.manage"), ent.setTierExclusions);
router.post("/membership/tiers/branch-scopes", requirePermission("pricing.membership.manage"), ent.setTierBranchScopes);
router.patch(
  "/membership/cards/:cardId(\\d+)",
  requirePermission("pricing.membership.manage"),
  ent.linkCardTier
);

router.get("/campaigns", requirePermission("pricing.campaign.manage", "org.read"), ent.listCampaigns);
router.post("/campaigns", requirePermission("pricing.campaign.manage"), ent.upsertCampaign);
router.patch("/campaigns/:id(\\d+)", requirePermission("pricing.campaign.manage"), ent.patchCampaign);

router.get(
  "/approval-matrix",
  requirePermission("pricing.approval.matrix.manage", "org.read"),
  ent.listMatrix
);
router.post("/approval-matrix", requirePermission("pricing.approval.matrix.manage"), ent.upsertMatrix);
router.delete(
  "/approval-matrix/:id(\\d+)",
  requirePermission("pricing.approval.matrix.manage"),
  ent.deleteMatrix
);

router.post(
  "/branch-override-requests",
  requirePermission("pricing.branch.override.request"),
  ent.createOverrideRequest
);
router.get(
  "/branch-override-requests",
  requirePermission("pricing.branch.override.approve", "pricing.branch.override.request", "pricing.audit.view"),
  ent.listOverrideRequests
);
router.patch(
  "/branch-override-requests/:id(\\d+)/review",
  requirePermission("pricing.branch.override.approve"),
  ent.reviewOverrideRequest
);

router.post("/emergency-overrides", requirePermission("pricing.emergency.override"), ent.createEmergency);

router.get(
  "/schedules",
  requirePermission("pricing.central.write", "pricing.audit.view", "org.read"),
  ent.listSchedules
);
router.post("/schedules", requirePermission("pricing.central.write"), ent.createSchedule);

router.get(
  "/stock-lots",
  requirePermission("pricing.central.write", "pricing.central.read", "org.read"),
  ent.listStockLots
);
router.get(
  "/batch-rules",
  requirePermission("pricing.central.write", "pricing.central.read", "org.read"),
  ent.listBatchRules
);
router.post("/batch-rules", requirePermission("pricing.central.write"), ent.upsertBatchRule);
router.get(
  "/batch-rules/export",
  requirePermission("pricing.central.write", "pricing.central.read", "org.read"),
  ent.exportBatchRules
);
router.post("/batch-rules/import-csv", requirePermission("pricing.central.write"), ent.importBatchRulesCsv);
router.get("/cost-signal", requirePermission("pricing.central.write", "pricing.analytics.view", "org.read"), ent.costSignal);

router.get("/analytics/summary", requirePermission("pricing.analytics.view", "org.read"), ent.analyticsSummary);
router.post(
  "/simulate",
  requirePermission(
    "pricing.central.write",
    "pricing.central.read",
    "pricing.audit.view",
    "org.read",
    "pricing.retail.rule.manage"
  ),
  ent.simulate
);
router.get(
  "/orders/:orderId(\\d+)/snapshots",
  requirePermission("pricing.analytics.view", "org.read"),
  ent.listOrderSnapshots
);

module.exports = router;

export {};
