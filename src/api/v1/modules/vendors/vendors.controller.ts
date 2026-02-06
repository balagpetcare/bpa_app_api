const service = require("./vendors.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * POST /api/v1/vendors
 * Create vendor
 */
exports.createVendor = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orgId, name, contactJson } = req.body;

    if (!orgId || !name) {
      return res.status(400).json({
        success: false,
        message: "orgId and name are required",
      });
    }

    // Verify user has access to org
    const orgMember = await prisma.orgMember.findFirst({
      where: { userId, orgId: parseInt(orgId), status: "ACTIVE" },
    });

    if (!orgMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this organization",
      });
    }

    const vendor = await service.createVendor({
      orgId: parseInt(orgId),
      name,
      contactJson,
    });

    return res.status(201).json({
      success: true,
      data: vendor,
      message: "Vendor created successfully",
    });
  } catch (error) {
    console.error("createVendor error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create vendor",
    });
  }
};

/**
 * POST /api/v1/vendors/:id/listings
 * Create vendor listing (draft)
 */
exports.createVendorListing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const vendorId = parseInt(req.params.id);
    const { productId, variantId, commissionRuleId } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "productId is required",
      });
    }

    const listing = await service.createVendorListing({
      vendorId,
      productId: parseInt(productId),
      variantId: variantId ? parseInt(variantId) : undefined,
      commissionRuleId: commissionRuleId ? parseInt(commissionRuleId) : undefined,
    });

    return res.status(201).json({
      success: true,
      data: listing,
      message: "Vendor listing created successfully",
    });
  } catch (error) {
    console.error("createVendorListing error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create vendor listing",
    });
  }
};

/**
 * POST /api/v1/vendors/listings/:id/approve
 * Approve vendor listing (admin only)
 */
exports.approveVendorListing = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // TODO: Add admin check

    const listingId = parseInt(req.params.id);
    if (!listingId) {
      return res.status(400).json({ success: false, message: "Invalid listing ID" });
    }

    const listing = await service.approveVendorListing(listingId);

    return res.status(200).json({
      success: true,
      data: listing,
      message: "Vendor listing approved successfully",
    });
  } catch (error) {
    console.error("approveVendorListing error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve vendor listing",
    });
  }
};

/**
 * GET /api/v1/vendors/listings
 * Get vendor listings
 */
exports.getVendorListings = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await service.getVendorListings({
      vendorId: req.query.vendorId ? parseInt(req.query.vendorId) : undefined,
      productId: req.query.productId ? parseInt(req.query.productId) : undefined,
      status: req.query.status as string | undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getVendorListings error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get vendor listings",
    });
  }
};

/**
 * POST /api/v1/commission-rules
 * Create commission rule
 */
exports.createCommissionRule = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { name, type, value, orgId, isDefault } = req.body;

    if (!name || !type || value === undefined) {
      return res.status(400).json({
        success: false,
        message: "name, type, and value are required",
      });
    }

    if (!["PERCENT", "FIXED"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be PERCENT or FIXED",
      });
    }

    const rule = await service.createCommissionRule({
      name,
      type,
      value: parseFloat(value),
      orgId: orgId ? parseInt(orgId) : undefined,
      isDefault: isDefault || false,
    });

    return res.status(201).json({
      success: true,
      data: rule,
      message: "Commission rule created successfully",
    });
  } catch (error) {
    console.error("createCommissionRule error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create commission rule",
    });
  }
};

export {};
