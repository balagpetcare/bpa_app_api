import * as retail from "./retailDiscount.service";

function permSet(req: any): Set<string> {
  const raw = req.user?.permissions || req.user?.perms || [];
  return new Set(Array.isArray(raw) ? raw.map((p: any) => String(p)) : []);
}

function can(req: any, ...keys: string[]): boolean {
  const s = permSet(req);
  return keys.some((k) => s.has(k) || s.has("global.admin"));
}

exports.listRules = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : undefined;
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "pricing.retail.rule.manage", "pricing.audit.view", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const branchId = req.query.branchId != null ? parseInt(req.query.branchId, 10) : undefined;
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const result = await retail.listRetailRules(orgId, { branchId, page, limit });
    return res.status(200).json({ success: true, data: result.items, pagination: { page: result.page, limit: result.limit, total: result.total } });
  } catch (e: any) {
    console.error("listRules", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.upsertRule = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.retail.rule.manage")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const {
      orgId,
      id,
      branchId,
      variantId,
      maxDiscountPercent,
      maxDiscountAmount,
      requiresApprovalAbovePercent,
      status,
      validFrom,
      validTo,
    } = req.body || {};
    if (!orgId || !variantId) {
      return res.status(400).json({ success: false, message: "orgId and variantId required" });
    }
    const row = await retail.upsertRetailRule(
      parseInt(orgId, 10),
      {
        id: id != null ? parseInt(id, 10) : undefined,
        branchId: branchId === null || branchId === "" ? null : branchId != null ? parseInt(branchId, 10) : null,
        variantId: parseInt(variantId, 10),
        maxDiscountPercent: maxDiscountPercent != null ? parseFloat(maxDiscountPercent) : null,
        maxDiscountAmount: maxDiscountAmount != null ? parseFloat(maxDiscountAmount) : null,
        requiresApprovalAbovePercent: requiresApprovalAbovePercent != null ? parseFloat(requiresApprovalAbovePercent) : null,
        status,
        validFrom: validFrom ? new Date(validFrom) : null,
        validTo: validTo ? new Date(validTo) : null,
      },
      userId
    );
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("upsertRule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.patchRule = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "pricing.retail.rule.manage")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const id = parseInt(req.params.id, 10);
    const orgId = req.body.orgId != null ? parseInt(req.body.orgId, 10) : undefined;
    const status = req.body.status != null ? String(req.body.status) : "INACTIVE";
    if (!id || !orgId) return res.status(400).json({ success: false, message: "id and orgId required" });
    const row = await retail.patchRetailRuleStatus(orgId, id, status, userId);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("patchRule", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.validateLine = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "retail.discount.apply", "pos.view", "orders.read", "orders.write", "inventory.read", "org.read")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { orgId, branchId, variantId, listUnitPrice, discountedUnitPrice, lineQty, approvalRequestId } = req.body || {};
    if (!orgId || !branchId || !variantId || listUnitPrice == null || discountedUnitPrice == null) {
      return res.status(400).json({ success: false, message: "orgId, branchId, variantId, listUnitPrice, discountedUnitPrice required" });
    }
    const result = await retail.validateRetailDiscountLine({
      orgId: parseInt(orgId, 10),
      branchId: parseInt(branchId, 10),
      variantId: parseInt(variantId, 10),
      listUnitPrice: parseFloat(listUnitPrice),
      discountedUnitPrice: parseFloat(discountedUnitPrice),
      lineQty: lineQty != null ? parseFloat(lineQty) : undefined,
      approvalRequestId:
        approvalRequestId != null && approvalRequestId !== "" ? parseInt(String(approvalRequestId), 10) : undefined,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("validateLine", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.listApprovals = async (req: any, res: any) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : undefined;
    if (!orgId) return res.status(400).json({ success: false, message: "orgId required" });
    if (!can(req, "retail.discount.approve", "pricing.retail.rule.manage")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const branchId = req.query.branchId != null ? parseInt(req.query.branchId, 10) : undefined;
    const rows = await retail.listPendingApprovals(orgId, branchId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listApprovals", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.submitApproval = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "retail.discount.apply", "pos.view", "orders.write")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { orgId, branchId, variantId, listUnitPrice, requestedUnitPrice, reason } = req.body || {};
    if (!orgId || !branchId || !variantId || listUnitPrice == null || requestedUnitPrice == null) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    const row = await retail.submitDiscountApprovalRequest(
      parseInt(orgId, 10),
      {
        branchId: parseInt(branchId, 10),
        variantId: parseInt(variantId, 10),
        listUnitPrice: parseFloat(listUnitPrice),
        requestedUnitPrice: parseFloat(requestedUnitPrice),
        reason,
      },
      userId
    );
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    console.error("submitApproval", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.reviewApproval = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!can(req, "retail.discount.approve")) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const id = parseInt(req.params.id, 10);
    const orgId = req.body.orgId != null ? parseInt(req.body.orgId, 10) : undefined;
    const { approve, reviewNote } = req.body || {};
    if (!id || !orgId || typeof approve !== "boolean") {
      return res.status(400).json({ success: false, message: "id, orgId, approve required" });
    }
    const row = await retail.reviewDiscountApprovalRequest(id, orgId, { approve, reviewNote }, userId);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("reviewApproval", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

export {};
