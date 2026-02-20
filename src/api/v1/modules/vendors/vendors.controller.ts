const service = require("./vendors.service");
const grnService = require("../grn/grn.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;
const { createVendorSchema, updateVendorSchema, vendorStatusSchema, addAttachmentSchema } = require("./vendors.validation");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIds(req: any): Promise<number[]> {
  const userId = getUserId(req);
  if (!userId) return [];
  return grnService.getOrgIdsForUser(userId);
}

function ensureOrgAccess(orgId: number, orgIds: number[]): boolean {
  return orgIds.includes(orgId);
}

/**
 * Resolve org for vendor APIs.
 * - If user has a single org: auto-resolve to that org when orgId is omitted.
 * - If user has multiple orgs: orgId (query or body) is required; do not default to first.
 */
function resolveOrgId(req: any, orgIds: number[]): number | null {
  const q = req.query?.orgId ?? req.body?.orgId;
  if (q != null && q !== "") {
    const id = parseInt(String(q));
    if (Number.isFinite(id) && ensureOrgAccess(id, orgIds)) return id;
  }
  if (orgIds.length === 1) return orgIds[0];
  return null;
}

/**
 * GET /api/v1/vendors/lookup?orgId=&q=
 */
exports.lookupVendors = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const orgId = resolveOrgId(req, orgIds);
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const q = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const items = await service.lookupVendors(orgId, q, limit);
    return res.status(200).json({ success: true, data: items });
  } catch (e) {
    console.error("lookupVendors error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Failed to lookup vendors" });
  }
};

/**
 * GET /api/v1/vendors?orgId=&search=&status=&page=&limit=
 */
exports.listVendors = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const orgId = resolveOrgId(req, orgIds);
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const result = await service.listVendors({
      orgId,
      search: req.query.search as string | undefined,
      status: req.query.status as "ACTIVE" | "INACTIVE" | "BLACKLISTED" | undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });
    return res.status(200).json({
      success: true,
      data: { items: result.items, pagination: result.pagination },
    });
  } catch (e) {
    console.error("listVendors error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Failed to list vendors" });
  }
};

/**
 * POST /api/v1/vendors
 * Create vendor (OWNER/ADMIN; org-scoped).
 */
exports.createVendor = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const parsed = createVendorSchema.safeParse({
      ...req.body,
      orgId: req.body.orgId != null ? parseInt(req.body.orgId) : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { orgId, ...rest } = parsed.data;
    if (!ensureOrgAccess(orgId, orgIds)) {
      return res.status(403).json({ success: false, message: "You don't have access to this organization" });
    }

    const vendor = await service.createVendor({ orgId, ...rest });
    return res.status(201).json({
      success: true,
      data: vendor,
      message: "Vendor created successfully",
    });
  } catch (error) {
    console.error("createVendor error:", error);
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to create vendor",
    });
  }
};

/**
 * GET /api/v1/vendors/:id?orgId=
 */
exports.getVendor = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!id) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const vendor = await service.getVendorById(id, orgId);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    return res.status(200).json({ success: true, data: vendor });
  } catch (e) {
    console.error("getVendor error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Failed to get vendor" });
  }
};

/**
 * PATCH /api/v1/vendors/:id
 */
exports.updateVendor = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!id) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const parsed = updateVendorSchema.safeParse(req.body);
    if (!parsed.success) {
      const err = parsed.error;
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: err.flatten().fieldErrors,
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const vendor = await service.updateVendor(id, orgId, parsed.data);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const { _count, ...rest } = vendor;
    return res.status(200).json({
      success: true,
      data: { ...rest, orderCount: _count?.grns ?? 0 },
      message: "Vendor updated successfully",
    });
  } catch (e) {
    console.error("updateVendor error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message || "Failed to update vendor" });
  }
};

/**
 * PATCH /api/v1/vendors/:id/status
 */
exports.setVendorStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!id) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const parsed = vendorStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Invalid status", errors: parsed.error.flatten().fieldErrors });
    }
    const vendor = await service.setVendorStatus(id, orgId, parsed.data.status);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    return res.status(200).json({ success: true, data: vendor, message: "Status updated" });
  } catch (e) {
    console.error("setVendorStatus error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message || "Failed to set status" });
  }
};

/**
 * DELETE /api/v1/vendors/:id?orgId=
 */
exports.deleteVendor = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!id) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const result = await service.deleteVendor(id, orgId);
    if (!result) return res.status(404).json({ success: false, message: "Vendor not found" });
    return res.status(200).json({ success: true, data: result, message: "Vendor deleted" });
  } catch (e) {
    if ((e as Error).message?.includes("cannot be deleted")) {
      return res.status(409).json({ success: false, message: (e as Error).message });
    }
    console.error("deleteVendor error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message || "Failed to delete vendor" });
  }
};

/**
 * GET /api/v1/vendors/:id/ledger?orgId=&limit=
 */
exports.getVendorLedger = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const vendorId = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!vendorId) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const entries = await service.getVendorLedger(vendorId, orgId, limit);
    if (!entries) return res.status(404).json({ success: false, message: "Vendor not found" });
    return res.status(200).json({ success: true, data: entries });
  } catch (e) {
    console.error("getVendorLedger error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Failed to get ledger" });
  }
};

/**
 * POST /api/v1/vendors/:id/attachments
 */
exports.addVendorAttachment = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const vendorId = parseInt(req.params.id);
    const orgId = resolveOrgId(req, orgIds);
    if (!vendorId) return res.status(400).json({ success: false, message: "Invalid vendor id" });
    if (orgId == null) {
      return res.status(400).json({
        success: false,
        message: "orgId is required when you have access to multiple organizations. Pass orgId in query or body.",
      });
    }
    const parsed = addAttachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
    }
    const attachment = await service.addVendorAttachment(vendorId, orgId, {
      fileKey: parsed.data.fileKey,
      type: parsed.data.type,
      note: parsed.data.note,
    });
    if (!attachment) return res.status(404).json({ success: false, message: "Vendor not found" });
    return res.status(201).json({ success: true, data: attachment, message: "Attachment added" });
  } catch (e) {
    console.error("addVendorAttachment error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message || "Failed to add attachment" });
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
