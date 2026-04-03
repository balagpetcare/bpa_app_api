const service = require("./pricing.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

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

    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: "orgId is required",
      });
    }

    const result = await service.listOrgPricing({ orgId, page, limit });

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
 * POST /api/v1/pricing/org
 * Set org-level product pricing
 */
exports.setOrgPricing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, variantId, basePrice, markupPercent, minPrice, maxPrice, effectiveFrom, effectiveTo } = req.body;

    if (!orgId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "orgId and variantId are required",
      });
    }

    const pricing = await service.setOrgPricing({
      orgId: parseInt(orgId),
      variantId: parseInt(variantId),
      basePrice: basePrice != null ? parseFloat(basePrice) : null,
      markupPercent: markupPercent != null ? parseFloat(markupPercent) : null,
      minPrice: minPrice != null ? parseFloat(minPrice) : null,
      maxPrice: maxPrice != null ? parseFloat(maxPrice) : null,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
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

    const pricing = await service.setBranchPricing({
      branchId: parseInt(branchId),
      variantId: parseInt(variantId),
      overridePrice: parseFloat(overridePrice),
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
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

    if (!orgId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "orgId and variantId are required",
      });
    }

    const resolved = await service.getResolvedSellingPrice({
      orgId,
      variantId,
      branchId,
      locationId,
    });

    return res.status(200).json({
      success: true,
      data: {
        price: resolved.price,
        source: resolved.source,
        breakdown: resolved.breakdown,
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

export {};
