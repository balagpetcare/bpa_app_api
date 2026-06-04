const service = require("./pricing.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const {
  validateCentralPricingBand,
  assertBranchOverrideWithinPolicy,
  logPricingAudit,
} = require("./pricingGovernance.service");

function pricingPermSet(req: any): Set<string> {
  const raw = req.user?.permissions || req.user?.perms || [];
  return new Set(Array.isArray(raw) ? raw.map((p: any) => String(p)) : []);
}

function canPrice(req: any, ...keys: string[]): boolean {
  const s = pricingPermSet(req);
  return keys.some((k) => s.has(k) || s.has("global.admin"));
}

/**
 * POST /api/v1/pricing
 * Set location price
 */
exports.setPrice = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, price, effectiveFrom, effectiveTo } = req.body;

    if (!locationId || !variantId || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and price are required",
      });
    }

    if (price < 0) {
      return res.status(400).json({
        success: false,
        message: "price must be non-negative",
      });
    }

    const locationPrice = await service.setLocationPrice({
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      price: parseFloat(price),
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: locationPrice,
      message: "Price set successfully",
    });
  } catch (error) {
    console.error("setPrice error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to set price",
    });
  }
};

/**
 * GET /api/v1/pricing
 * Get location price
 */
exports.getPrice = async (req, res) => {
  try {
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;

    if (!locationId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "locationId and variantId are required",
      });
    }

    const price = await service.getLocationPrice(locationId, variantId);

    const location = await prisma.inventoryLocation.findUnique({
      where: { id: locationId },
      select: { branch: { select: { id: true, orgId: true } } },
    });
    let resolved = null;
    if (location?.branch) {
      resolved = await service.getResolvedSellingPrice({
        orgId: location.branch.orgId,
        variantId,
        branchId: location.branch.id,
        locationId,
      });
    }

    return res.status(200).json({
      success: true,
      data: price,
      meta: {
        resolvedPrice: resolved?.price ?? null,
        resolutionSource: resolved?.source ?? null,
        breakdown: resolved?.breakdown ?? null,
      },
    });
  } catch (error) {
    console.error("getPrice error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get price",
    });
  }
};

/**
 * POST /api/v1/inventory/locations/:locationId/variants/:variantId/enable
 * Enable variant at location with channel config
 */
exports.enableLocationVariant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const locationId = parseInt(req.params.locationId);
    const variantId = parseInt(req.params.variantId);
    const { channel, isEnabled } = req.body;

    if (!channel || !["POS_ONLY", "ONLINE_ONLY", "BOTH"].includes(channel)) {
      return res.status(400).json({
        success: false,
        message: "channel must be POS_ONLY, ONLINE_ONLY, or BOTH",
      });
    }

    const config = await service.enableLocationVariant({
      locationId,
      variantId,
      channel,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
    });

    return res.status(200).json({
      success: true,
      data: config,
      message: "Location variant config updated successfully",
    });
  } catch (error) {
    console.error("enableLocationVariant error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to enable location variant",
    });
  }
};

/**
 * GET /api/v1/pricing/org
 * List org-level product pricings
 */
exports.listOrgPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orgId = req.query.orgId ? parseInt(req.query.orgId) : undefined;
    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "50");
    const q = req.query.q ? String(req.query.q) : undefined;
    const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId), 10) : undefined;
    const unpricedOnly = String(req.query.unpriced || "") === "1" || String(req.query.unpriced || "") === "true";
    const sortByRaw = req.query.sortBy ? String(req.query.sortBy) : undefined;
    const sortBy =
      sortByRaw === "sku" || sortByRaw === "basePrice" || sortByRaw === "updatedAt" ? sortByRaw : "updatedAt";
    const sortOrderRaw = req.query.sortOrder ? String(req.query.sortOrder).toLowerCase() : "desc";
    const sortOrder = sortOrderRaw === "asc" ? "asc" : "desc";

    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: "orgId is required",
      });
    }

    const result = await service.listOrgPricing({
      orgId,
      page,
      limit,
      q,
      categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
      unpricedOnly,
      sortBy,
      sortOrder,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error("listOrgPricing error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list org pricing",
    });
  }
};

/**
 * GET /api/v1/pricing/org/meta
 * Category options and other lightweight filter metadata for org pricing workspace.
 */
exports.listOrgPricingMeta = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId ? parseInt(String(req.query.orgId), 10) : NaN;
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, message: "orgId is required" });
    }
    const meta = await service.listOrgPricingMeta(orgId);
    return res.status(200).json({ success: true, data: meta });
  } catch (error: any) {
    console.error("listOrgPricingMeta error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to load meta" });
  }
};

/**
 * POST /api/v1/pricing/org
 * Set org-level product pricing
 */
exports.setOrgPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, variantId, basePrice, markupPercent, minPrice, maxPrice, mrp, effectiveFrom, effectiveTo } = req.body;

    if (!orgId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "orgId and variantId are required",
      });
    }

    if (!canPrice(req, "pricing.central.write")) {
      return res.status(403).json({
        success: false,
        message: "pricing.central.write required to edit central catalog pricing",
      });
    }

    const oid = parseInt(orgId);
    const vid = parseInt(variantId);
    const payload = {
      basePrice: basePrice != null ? parseFloat(basePrice) : null,
      markupPercent: markupPercent != null ? parseFloat(markupPercent) : null,
      minPrice: minPrice != null ? parseFloat(minPrice) : null,
      maxPrice: maxPrice != null ? parseFloat(maxPrice) : null,
      mrp: mrp != null && mrp !== "" ? parseFloat(mrp) : null,
    };
    validateCentralPricingBand(payload);

    const before = await prisma.productPricing.findUnique({
      where: { orgId_variantId: { orgId: oid, variantId: vid } },
    });

    const pricing = await service.setOrgPricing({
      orgId: oid,
      variantId: vid,
      basePrice: payload.basePrice,
      markupPercent: payload.markupPercent,
      minPrice: payload.minPrice,
      maxPrice: payload.maxPrice,
      mrp: payload.mrp,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
    });

    await logPricingAudit({
      orgId: oid,
      entityType: "PRODUCT_PRICING",
      entityKey: `org:${oid}:variant:${vid}`,
      action: "UPSERT",
      actorUserId: userId,
      payloadBefore: before,
      payloadAfter: pricing,
    });

    return res.status(200).json({
      success: true,
      data: pricing,
      message: "Org pricing set successfully",
    });
  } catch (error) {
    console.error("setOrgPricing error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to set org pricing",
    });
  }
};

/**
 * GET /api/v1/pricing/branch
 * List branch pricing overrides
 */
exports.listBranchPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = req.query.branchId ? parseInt(req.query.branchId) : undefined;
    const page = parseInt(req.query.page || "1");
    const limit = parseInt(req.query.limit || "50");

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "branchId is required",
      });
    }

    const result = await service.listBranchPricing({ branchId, page, limit });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error("listBranchPricing error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to list branch pricing",
    });
  }
};

/**
 * POST /api/v1/pricing/branch
 * Set branch pricing override
 */
exports.setBranchPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, variantId, overridePrice, effectiveFrom, effectiveTo } = req.body;

    if (!branchId || !variantId || overridePrice === undefined) {
      return res.status(400).json({
        success: false,
        message: "branchId, variantId, and overridePrice are required",
      });
    }

    if (overridePrice < 0) {
      return res.status(400).json({
        success: false,
        message: "overridePrice must be non-negative",
      });
    }

    if (!canPrice(req, "pricing.branch.override")) {
      return res.status(403).json({
        success: false,
        message: "pricing.branch.override required for branch price overrides",
      });
    }

    const bid = parseInt(branchId);
    const vid = parseInt(variantId);
    const ov = parseFloat(overridePrice);
    const branch = await prisma.branch.findUnique({
      where: { id: bid },
      select: { orgId: true },
    });
    if (!branch) {
      return res.status(400).json({ success: false, message: "Branch not found" });
    }
    await assertBranchOverrideWithinPolicy(branch.orgId, vid, ov);

    const before = await prisma.branchPricing.findUnique({
      where: { branchId_variantId: { branchId: bid, variantId: vid } },
    });

    const pricing = await service.setBranchPricing({
      branchId: bid,
      variantId: vid,
      overridePrice: ov,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
    });

    await logPricingAudit({
      orgId: branch.orgId,
      entityType: "BRANCH_PRICING",
      entityKey: `branch:${bid}:variant:${vid}`,
      action: "UPSERT",
      actorUserId: userId,
      payloadBefore: before,
      payloadAfter: pricing,
    });

    return res.status(200).json({
      success: true,
      data: pricing,
      message: "Branch pricing set successfully",
    });
  } catch (error) {
    console.error("setBranchPricing error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to set branch pricing",
    });
  }
};

/**
 * GET /api/v1/pricing/resolve
 * Resolve selling price for variant at location
 */
exports.resolvePrice = async (req, res) => {
  try {
    const orgId = req.query.orgId ? parseInt(req.query.orgId) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;
    const branchId = req.query.branchId ? parseInt(req.query.branchId) : null;
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : null;
    const enterprise = req.query.enterprise === "1";
    let membershipTierId: number | null = null;
    if (req.query.membershipTierId != null) {
      const n = parseInt(String(req.query.membershipTierId), 10);
      if (Number.isFinite(n)) membershipTierId = n;
    }

    if (!orgId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "orgId and variantId are required",
      });
    }

    let lotId: number | null = null;
    if (req.query.lotId != null) {
      const ln = parseInt(String(req.query.lotId), 10);
      if (Number.isFinite(ln)) lotId = ln;
    }

    let resolved;
    if (enterprise && branchId != null) {
      const { resolveSellingPriceWithEnterprise } = require("./pricingEngine.service");
      resolved = await resolveSellingPriceWithEnterprise({
        orgId,
        variantId,
        branchId,
        locationId,
        shopLocationId: locationId,
        membershipTierId,
        lotId,
      });
    } else {
      resolved = await service.getResolvedSellingPrice({
        orgId,
        variantId,
        branchId,
        locationId,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        price: resolved.price,
        source: resolved.source,
        breakdown: resolved.breakdown,
        enterpriseTrace: resolved.enterpriseTrace ?? undefined,
      },
    });
  } catch (error) {
    console.error("resolvePrice error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to resolve price",
    });
  }
};

/**
 * POST /api/v1/pricing/org/bulk
 * Bulk upsert org product pricing (rows validated individually).
 */
exports.bulkOrgPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!canPrice(req, "pricing.central.write", "pricing.bulk.import")) {
      return res.status(403).json({
        success: false,
        message: "pricing.central.write or pricing.bulk.import required",
      });
    }
    const { orgId, rows } = req.body || {};
    if (!orgId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "orgId and non-empty rows[] required" });
    }
    const oid = parseInt(orgId, 10);
    const capped = rows.slice(0, 500);
    for (const r of capped) {
      const has =
        r.basePrice != null ||
        r.markupPercent != null ||
        r.minPrice != null ||
        r.maxPrice != null ||
        (r.mrp != null && r.mrp !== "");
      if (!has) continue;
      const payload = {
        basePrice: r.basePrice != null ? parseFloat(r.basePrice) : null,
        markupPercent: r.markupPercent != null ? parseFloat(r.markupPercent) : null,
        minPrice: r.minPrice != null ? parseFloat(r.minPrice) : null,
        maxPrice: r.maxPrice != null ? parseFloat(r.maxPrice) : null,
        mrp: r.mrp != null && r.mrp !== "" ? parseFloat(r.mrp) : null,
      };
      validateCentralPricingBand(payload);
    }
    const result = await service.bulkUpsertOrgPricing(
      oid,
      capped.map((r: any) => ({
        variantId: parseInt(r.variantId, 10),
        basePrice: r.basePrice != null ? parseFloat(r.basePrice) : null,
        markupPercent: r.markupPercent != null ? parseFloat(r.markupPercent) : null,
        minPrice: r.minPrice != null ? parseFloat(r.minPrice) : null,
        maxPrice: r.maxPrice != null ? parseFloat(r.maxPrice) : null,
        mrp: r.mrp != null && r.mrp !== "" ? parseFloat(r.mrp) : null,
      }))
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error("bulkOrgPricing error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed bulk pricing update",
    });
  }
};

export {};
