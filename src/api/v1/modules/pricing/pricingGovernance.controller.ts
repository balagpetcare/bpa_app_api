import * as gov from "./pricingGovernance.service";

function permSet(req: any): Set<string> {
  const raw = req.user?.permissions || req.user?.perms || [];
  return new Set(Array.isArray(raw) ? raw.map((p: any) => String(p)) : []);
}

function can(req: any, ...keys: string[]): boolean {
  const s = permSet(req);
  return keys.some((k) => s.has(k) || s.has("global.admin"));
}

exports.getPolicy = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : undefined;
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.read", "pricing.audit.view", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const policy = await gov.getOrCreateOrgPolicy(orgId);
    return res.status(200).json({ success: true, data: policy });
  } catch (e: any) {
    console.error("getPolicy", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.patchPolicy = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.body.orgId != null ? parseInt(req.body.orgId, 10) : undefined;
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.write")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const b = req.body || {};
    const policy = await gov.updateOrgPolicy(
      orgId,
      {
        enforceBranchOverrideWithinCentralBand: b.enforceBranchOverrideWithinCentralBand,
        retailDiscountApprovalEnabled: b.retailDiscountApprovalEnabled,
        posPricingGovernanceEnabled: b.posPricingGovernanceEnabled,
        posUseEnterpriseListResolution: b.posUseEnterpriseListResolution,
        blockSaleBelowCost: b.blockSaleBelowCost,
        blockSaleBelowFloor: b.blockSaleBelowFloor,
        allowCampaignStacking: b.allowCampaignStacking,
        allowMembershipStacking: b.allowMembershipStacking,
        scheduledPricingEnabled: b.scheduledPricingEnabled,
        batchPricingEnabled: b.batchPricingEnabled,
        defaultMaxDiscountPercent:
          b.defaultMaxDiscountPercent === "" || b.defaultMaxDiscountPercent === undefined
            ? undefined
            : b.defaultMaxDiscountPercent != null
              ? Number(b.defaultMaxDiscountPercent)
              : undefined,
      },
      userId
    );
    return res.status(200).json({ success: true, data: policy });
  } catch (e: any) {
    console.error("patchPolicy", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listAudit = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : undefined;
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.read", "pricing.audit.view", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
    const entityKeyContains = typeof req.query.entityKeyContains === "string" ? req.query.entityKeyContains : undefined;
    const result = await gov.listPricingAudit(orgId, { page, limit, entityType, entityKeyContains });
    return res.status(200).json({ success: true, data: result.items, pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages } });
  } catch (e: any) {
    console.error("listAudit", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

export {};
