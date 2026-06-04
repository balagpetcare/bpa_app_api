import prisma from "../../../../infrastructure/db/prismaClient";
import * as ent from "./enterprisePricing.service";
import * as snap from "./priceResolutionSnapshot.service";

function permSet(req: any): Set<string> {
  const raw = req.user?.permissions || req.user?.perms || [];
  return new Set(Array.isArray(raw) ? raw.map((p: any) => String(p)) : []);
}

function can(req: any, ...keys: string[]): boolean {
  const s = permSet(req);
  return keys.some((k) => s.has(k) || s.has("global.admin"));
}

function parseOrgId(req: any): number | undefined {
  const q = req.query?.orgId ?? req.body?.orgId;
  if (q == null) return undefined;
  const n = parseInt(String(q), 10);
  return Number.isFinite(n) ? n : undefined;
}

exports.listEnterpriseRules = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.retail.rule.manage", "pricing.audit.view", "org.read", "pricing.central.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    let stackable: boolean | undefined;
    if (req.query.stackable === "1" || String(req.query.stackable).toLowerCase() === "true") stackable = true;
    if (req.query.stackable === "0" || String(req.query.stackable).toLowerCase() === "false") stackable = false;
    const effRaw = typeof req.query.effective === "string" ? req.query.effective.toLowerCase() : "";
    const effective =
      effRaw === "current" || effRaw === "expired" || effRaw === "scheduled" ? (effRaw as "current" | "expired" | "scheduled") : undefined;
    const atIso = typeof req.query.at === "string" && req.query.at.trim() ? new Date(req.query.at) : undefined;
    const ruleIdRaw = req.query.ruleId;
    const ruleIdParsed =
      ruleIdRaw != null && String(ruleIdRaw).trim() !== "" ? parseInt(String(ruleIdRaw), 10) : NaN;
    const ruleId = Number.isFinite(ruleIdParsed) ? ruleIdParsed : undefined;
    const r = await ent.listEnterpriseDiscountRules(orgId, page, limit, {
      ruleId,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      targetKind: typeof req.query.targetKind === "string" ? req.query.targetKind : undefined,
      scopeKind: typeof req.query.scopeKind === "string" ? req.query.scopeKind : undefined,
      stackable,
      sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
      effective,
      at: atIso && !Number.isNaN(atIso.getTime()) ? atIso : undefined,
    });
    return res.status(200).json({ success: true, data: r.items, pagination: { page: r.page, limit: r.limit, total: r.total } });
  } catch (e: any) {
    console.error("listEnterpriseRules", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertEnterpriseRule = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.retail.rule.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.upsertEnterpriseDiscountRule(req.body.orgId, req.body, req.user.id);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertEnterpriseRule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.patchEnterpriseRule = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.retail.rule.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const orgId = parseInt(req.body.orgId, 10);
    const id = parseInt(req.params.id, 10);
    const status = String(req.body.status ?? "INACTIVE");
    const row = await ent.patchEnterpriseDiscountRuleStatus(orgId, id, status, req.user.id);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("patchEnterpriseRule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listTiers = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.membership.manage", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await ent.listMembershipTiers(orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listTiers", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

/** GET /pricing/membership/cards?orgId= — selector data for linking discount cards to tiers */
exports.listMembershipCards = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.membership.manage", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await ent.listOwnerDiscountCardsForMembership(orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listMembershipCards", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertTier = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.membership.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.upsertMembershipTier(req.body.orgId, req.body);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertTier", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.setTierExclusions = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.membership.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.setMembershipTierExclusions(req.body.tierId, req.body.orgId, req.body.exclusions ?? []);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("setTierExclusions", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.setTierBranchScopes = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.membership.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.setMembershipTierBranchScopes(req.body.tierId, req.body.orgId, req.body.branchIds ?? []);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("setTierBranchScopes", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.linkCardTier = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.membership.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const cardId = parseInt(req.params.cardId, 10);
    const row = await ent.linkOwnerDiscountCardToTier(req.body.orgId, cardId, req.body.membershipTierId ?? null);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("linkCardTier", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listCampaigns = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.campaign.manage", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await ent.listPricingCampaigns(orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listCampaigns", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertCampaign = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.campaign.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const b = req.body;
    const row = await ent.upsertPricingCampaign(
      b.orgId,
      {
        ...b,
        startDate: b.startDate ? new Date(b.startDate) : undefined,
        endDate: b.endDate ? new Date(b.endDate) : undefined,
      },
      req.user.id
    );
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertCampaign", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.patchCampaign = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.campaign.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const id = parseInt(req.params.id, 10);
    const row = await ent.patchCampaignStatus(req.body.orgId, id, req.body.status);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("patchCampaign", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listMatrix = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.approval.matrix.manage", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await ent.listApprovalMatrix(orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listMatrix", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertMatrix = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.approval.matrix.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.upsertApprovalMatrixRow(req.body.orgId, req.body);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertMatrix", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.deleteMatrix = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.approval.matrix.manage")) return res.status(403).json({ success: false, message: "Forbidden" });
    await ent.deleteApprovalMatrixRow(parseInt(req.query.orgId, 10), parseInt(req.params.id, 10));
    return res.status(200).json({ success: true });
  } catch (e: any) {
    console.error("deleteMatrix", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.createOverrideRequest = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.branch.override.request")) return res.status(403).json({ success: false, message: "Forbidden" });
    const orgId = parseInt(String(req.body.orgId), 10);
    const branchId = parseInt(String(req.body.branchId), 10);
    if (!Number.isFinite(orgId) || !Number.isFinite(branchId)) {
      return res.status(400).json({ success: false, message: "orgId and branchId required" });
    }
    const membership = await prisma.branchMember.findFirst({
      where: { userId: req.user.id, branchId, status: "ACTIVE" },
      include: { branch: { select: { orgId: true } } },
    });
    if (!membership || membership.branch.orgId !== orgId) {
      return res.status(403).json({ success: false, message: "Not an active member of this branch" });
    }
    const row = await ent.createBranchOverrideRequest(orgId, req.body, req.user.id);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("createOverrideRequest", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listOverrideRequests = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    const approver = can(req, "pricing.branch.override.approve");
    const auditor = can(req, "pricing.audit.view");
    const requester = can(req, "pricing.branch.override.request");
    if (!approver && !auditor && !requester) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const branchIdRaw = req.query.branchId != null ? parseInt(String(req.query.branchId), 10) : undefined;
    const branchId = branchIdRaw != null && Number.isFinite(branchIdRaw) ? branchIdRaw : undefined;

    let filterBranchId = branchId;
    if (!approver && !auditor) {
      if (!requester) return res.status(403).json({ success: false, message: "Forbidden" });
      if (branchId == null) {
        return res.status(400).json({ success: false, message: "branchId required" });
      }
      const membership = await prisma.branchMember.findFirst({
        where: { userId: req.user.id, branchId, status: "ACTIVE" },
        include: { branch: { select: { orgId: true } } },
      });
      if (!membership || membership.branch.orgId !== orgId) {
        return res.status(403).json({ success: false, message: "Not an active member of this branch" });
      }
      filterBranchId = branchId;
    }

    const rows = await ent.listBranchOverrideRequests(orgId, { status: req.query.status, branchId: filterBranchId });
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listOverrideRequests", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.reviewOverrideRequest = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.branch.override.approve")) return res.status(403).json({ success: false, message: "Forbidden" });
    const id = parseInt(req.params.id, 10);
    const row = await ent.reviewBranchOverrideRequest(req.body.orgId, id, !!req.body.approve, req.body.reviewNote ?? null, req.user.id);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("reviewOverrideRequest", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.createEmergency = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.emergency.override")) return res.status(403).json({ success: false, message: "Forbidden" });
    const b = req.body;
    const row = await ent.createPricingEmergencyOverride(
      b.orgId,
      { ...b, expiresAt: new Date(b.expiresAt) },
      req.user.id
    );
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("createEmergency", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listSchedules = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.write", "pricing.audit.view", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const rows = await ent.listPriceSchedules(orgId, { status: req.query.status });
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listSchedules", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.createSchedule = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.central.write")) return res.status(403).json({ success: false, message: "Forbidden" });
    const b = req.body;
    const row = await ent.createPriceSchedule(
      b.orgId,
      { ...b, effectiveAt: new Date(b.effectiveAt) },
      req.user.id
    );
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("createSchedule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listBatchRules = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.write", "pricing.central.read", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const variantId = req.query.variantId != null ? parseInt(req.query.variantId, 10) : undefined;
    const rows = await ent.listBatchPricingRules(orgId, variantId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listBatchRules", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listStockLots = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    const variantId = req.query.variantId != null ? parseInt(req.query.variantId, 10) : NaN;
    if (!orgId || !Number.isFinite(variantId)) return res.status(400).json({ success: false, message: "orgId and variantId required" });
    if (!can(req, "pricing.central.write", "pricing.central.read", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await ent.listStockLotsForVariant(orgId, variantId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listStockLots", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertBatchRule = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.central.write")) return res.status(403).json({ success: false, message: "Forbidden" });
    const row = await ent.upsertBatchPricingRule(req.body.orgId, req.body, req.user.id);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertBatchRule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.exportBatchRules = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.central.write", "pricing.central.read", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const vidRaw = req.query.variantId != null ? parseInt(String(req.query.variantId), 10) : NaN;
    const variantId = Number.isFinite(vidRaw) ? vidRaw : undefined;
    const csv = await ent.exportBatchPricingRulesCsv(orgId, variantId);
    return res.status(200).json({
      success: true,
      data: { csv, filename: `batch-pricing-org-${orgId}${variantId != null ? `-variant-${variantId}` : ""}.csv` },
    });
  } catch (e: any) {
    console.error("exportBatchRules", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.importBatchRulesCsv = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.central.write")) return res.status(403).json({ success: false, message: "Forbidden" });
    const orgId = req.body.orgId != null ? parseInt(String(req.body.orgId), 10) : NaN;
    if (!Number.isFinite(orgId)) return res.status(400).json({ success: false, message: "orgId required" });
    const rawCsv = req.body?.csv;
    const csv = typeof rawCsv === "string" ? rawCsv : rawCsv != null ? String(rawCsv) : "";
    if (!csv.trim()) {
      return res.status(400).json({ success: false, message: "csv is required (non-empty string)" });
    }
    const data = await ent.importBatchPricingRulesFromCsv(orgId, csv, req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("importBatchRulesCsv", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.costSignal = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    const variantId = req.query.variantId ? parseInt(req.query.variantId, 10) : undefined;
    if (!orgId || !variantId) return res.status(400).json({ success: false, message: "orgId and variantId required" });
    if (!can(req, "pricing.central.write", "pricing.central.read", "pricing.analytics.view", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const sig = await ent.getVariantCostSignal(orgId, variantId);
    return res.status(200).json({ success: true, data: sig });
  } catch (e: any) {
    console.error("costSignal", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.analyticsSummary = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.analytics.view", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const data = await ent.getPricingAnalyticsSummary(orgId);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("analyticsSummary", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.simulate = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (
      !can(
        req,
        "pricing.central.write",
        "pricing.central.read",
        "pricing.audit.view",
        "org.read",
        "pricing.retail.rule.manage",
        "pricing.membership.manage"
      )
    ) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const orgId = parseInt(String(req.body.orgId), 10);
    const branchId = parseInt(String(req.body.branchId), 10);
    const variantId = parseInt(String(req.body.variantId), 10);
    if (!Number.isFinite(orgId) || !Number.isFinite(branchId) || !Number.isFinite(variantId)) {
      return res.status(400).json({ success: false, message: "orgId, branchId, and variantId must be valid numbers" });
    }
    let membershipTierId: number | null = null;
    if (req.body.membershipTierId != null) {
      const n = parseInt(String(req.body.membershipTierId), 10);
      if (Number.isFinite(n)) membershipTierId = n;
    }
    let lotId: number | null = null;
    if (req.body.lotId != null) {
      const ln = parseInt(String(req.body.lotId), 10);
      if (Number.isFinite(ln)) lotId = ln;
    }
    let discountedUnitPrice: number | null = null;
    if (req.body.discountedUnitPrice != null && String(req.body.discountedUnitPrice).trim() !== "") {
      const d = Number(req.body.discountedUnitPrice);
      if (Number.isFinite(d)) discountedUnitPrice = d;
    }
    let locationId: number | null = null;
    if (req.body.locationId != null && String(req.body.locationId).trim() !== "") {
      const loc = parseInt(String(req.body.locationId), 10);
      if (Number.isFinite(loc)) locationId = loc;
    }
    const data = await ent.simulatePriceForVariant({
      orgId,
      branchId,
      locationId,
      variantId,
      membershipTierId,
      membershipTierDiscountPercent:
        req.body.membershipTierDiscountPercent != null ? Number(req.body.membershipTierDiscountPercent) : null,
      lotId,
      discountedUnitPrice,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("simulate", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listOrderSnapshots = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = parseOrgId(req);
    const orderId = parseInt(req.params.orderId, 10);
    if (!orgId || !orderId) return res.status(400).json({ success: false, message: "orgId and orderId required" });
    if (!can(req, "pricing.analytics.view", "org.read")) return res.status(403).json({ success: false, message: "Forbidden" });
    const rows = await snap.listSnapshotsByOrderId(orgId, orderId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listOrderSnapshots", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

export {};
