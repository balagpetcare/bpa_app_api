const service = require("./inventory.service");
const ledgerService = require("./ledger.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const { INVENTORY_ERROR_CODES } = require("../../constants/inventoryErrors");

/**
 * GET /api/v1/inventory
 * List inventory (ledger-derived summary v2)
 */
exports.getInventory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    });
    const branchId = branchMember?.branchId || (req.query.branchId ? parseInt(req.query.branchId) : undefined);
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;

    const result = await service.getInventorySummaryV2({
      branchId,
      locationId,
      productId: req.query.productId ? parseInt(req.query.productId) : undefined,
      variantId: req.query.variantId ? parseInt(req.query.variantId) : undefined,
      search: req.query.search as string | undefined,
      lowStockOnly: req.query.lowStockOnly === "true",
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
    });

    const items = result.items.map((i: any) => ({
      ...i,
      branch: i.location?.branch || null,
      branchId: i.location?.branch?.id ?? null,
      minStock: 10,
      expiryDate: null,
    }));

    return res.status(200).json({
      success: true,
      data: items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getInventory error:", error);
    return res.status(500).json({
      success: false,
      message: (error as Error).message || "Failed to get inventory",
    });
  }
};

exports.blockedUpsert = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Legacy inventory upsert disabled. Use POST /inventory/opening with lot info or POST /inventory/adjustment-requests.",
  });
};

exports.blockedAdjust = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Legacy inventory adjust disabled. Use POST /inventory/adjustment-requests.",
  });
};

exports.blockedTransfer = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Legacy inventory transfer disabled. Use POST /api/v1/transfers.",
  });
};

exports.blockedAdjustNew = async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: "Direct adjustment disabled. Use POST /inventory/adjustment-requests.",
  });
};

exports.getInventorySummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    });
    const result = await service.getInventorySummaryV2({
      branchId: branchMember?.branchId || (req.query.branchId ? parseInt(req.query.branchId) : undefined),
      locationId: req.query.locationId ? parseInt(req.query.locationId) : undefined,
      productId: req.query.productId ? parseInt(req.query.productId) : undefined,
      variantId: req.query.variantId ? parseInt(req.query.variantId) : undefined,
      search: req.query.search as string | undefined,
      lowStockOnly: req.query.lowStockOnly === "true",
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e) {
    console.error("getInventorySummary error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

exports.getInventoryLocations = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const locations = await service.getInventoryLocations(userId);
    return res.status(200).json({ success: true, data: locations });
  } catch (e) {
    console.error("getInventoryLocations error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

exports.getInventoryLots = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    if (!locationId) return res.status(400).json({ success: false, message: "locationId required" });
    const excludeExpired = req.query.excludeExpired !== "false";
    const lots = await service.getInventoryLots({
      locationId,
      variantId: req.query.variantId ? parseInt(req.query.variantId) : undefined,
      excludeExpired,
    });
    return res.status(200).json({ success: true, data: lots });
  } catch (e) {
    console.error("getInventoryLots error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

exports.createAdjustmentRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { locationId, variantId, lotId, quantityDelta, reason, adjustmentCategory } = req.body;
    if (!locationId || !variantId || quantityDelta === undefined) {
      return res.status(400).json({ success: false, message: "locationId, variantId, quantityDelta required" });
    }

    const variant = await prisma.productVariant.findUnique({
      where: { id: parseInt(variantId) },
      include: { product: true },
    });
    if (!variant) return res.status(404).json({ success: false, message: "Variant not found" });

    const location = await prisma.inventoryLocation.findUnique({
      where: { id: parseInt(locationId) },
      include: { branch: true },
    });
    if (!location) return res.status(404).json({ success: false, message: "Location not found" });

    const orgId = location.branch.orgId;
    const member = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
    const isOwner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId } });
    if (!member && !isOwner) return res.status(403).json({ success: false, message: "Not authorized" });

    const category = adjustmentCategory && ["DAMAGE", "LOSS", "CORRECTION"].includes(String(adjustmentCategory).toUpperCase()) ? String(adjustmentCategory).toUpperCase() : null;
    const adj = await prisma.stockAdjustmentRequest.create({
      data: {
        orgId,
        locationId: parseInt(locationId),
        variantId: parseInt(variantId),
        lotId: lotId != null ? parseInt(lotId) : null,
        quantityDelta: parseInt(quantityDelta),
        reason: reason || null,
        adjustmentCategory: category,
        status: "PENDING",
        requestedByUserId: userId,
      },
      include: {
        location: true,
        variant: true,
        requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    });
    return res.status(201).json({ success: true, data: adj, message: "Adjustment request created" });
  } catch (e) {
    console.error("createAdjustmentRequest error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message });
  }
};

/**
 * PATCH /api/v1/inventory/adjustment-requests/:id
 * Approve or reject adjustment request. Approve writes ADJUSTMENT/DAMAGE/LOSS ledger and updates status.
 */
exports.reviewAdjustmentRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { status: newStatus, reviewNote } = req.body || {};
    if (!["APPROVED", "REJECTED"].includes(newStatus)) {
      return res.status(400).json({ success: false, message: "status must be APPROVED or REJECTED" });
    }

    const request = await prisma.stockAdjustmentRequest.findUnique({
      where: { id },
      include: { location: { select: { id: true } }, variant: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Adjustment request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
    }

    const member = await prisma.orgMember.findFirst({ where: { userId, orgId: request.orgId, status: "ACTIVE" } });
    const isOwner = await prisma.organization.findFirst({ where: { id: request.orgId, ownerUserId: userId } });
    if (!member && !isOwner) return res.status(403).json({ success: false, message: "Not authorized" });

    if (newStatus === "REJECTED") {
      const updated = await prisma.stockAdjustmentRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: reviewNote || null },
        include: { location: true, variant: true },
      });
      return res.status(200).json({ success: true, data: updated, message: "Adjustment request rejected" });
    }

    const ledgerType = request.adjustmentCategory === "DAMAGE" ? "DAMAGE" : request.adjustmentCategory === "LOSS" ? "LOSS" : "ADJUSTMENT";
    await prisma.$transaction(async (tx) => {
      await ledgerService.recordLedgerEntryInTx(tx, {
        orgId: request.orgId,
        locationId: request.locationId,
        variantId: request.variantId,
        lotId: request.lotId ?? undefined,
        type: ledgerType,
        quantityDelta: request.quantityDelta,
        refType: "ADJUSTMENT_REQUEST",
        refId: String(request.id),
        createdByUserId: userId,
      });
      await tx.stockAdjustmentRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: reviewNote || null },
      });
    });

    const updated = await prisma.stockAdjustmentRequest.findUnique({
      where: { id },
      include: { location: true, variant: true, reviewedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    return res.status(200).json({ success: true, data: updated, message: "Adjustment applied" });
  } catch (e) {
    console.error("reviewAdjustmentRequest error:", e);
    return res.status(400).json({ success: false, message: (e && e.message) || "Review failed" });
  }
};

const grnService = require("../grn/grn.service");

/**
 * GET /api/v1/inventory/receipts/bulk-template
 * Download CSV template for bulk receive (variantId, sku, quantity, unitCost, lotCode, mfgDate, expDate).
 */
exports.getBulkReceiveTemplate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const header = "variantId,sku,quantity,unitCost,lotCode,mfgDate,expDate\n";
    const example = "1,SKU-001,10,99.50,LOT-2024-01,2024-01-15,2025-01-15\n";
    const csv = header + example;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="bulk-receive-template.csv"');
    return res.status(200).send(csv);
  } catch (e) {
    console.error("getBulkReceiveTemplate error:", e);
    return res.status(500).json({ success: false, message: (e && (e as Error).message) || "Failed" });
  }
};

/**
 * POST /api/v1/inventory/receipts/bulk
 * Bulk purchase receive: create GRN + receive in one atomic call.
 * Body: { locationId, vendorId, invoiceNo?, invoiceDate?, notes?, lines: [{ variantId, quantity, unitCost?, lotCode?, mfgDate?, expDate? }] }
 */
exports.createBulkReceipt = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { locationId, vendorId, invoiceNo, invoiceDate, notes, lines } = req.body || {};
    const locId = locationId != null ? parseInt(locationId, 10) : NaN;
    const vendorIdNum = vendorId != null && vendorId !== "" ? parseInt(vendorId, 10) : null;
    if (!Number.isInteger(locId) || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: "locationId and non-empty lines required" });
    }
    if (vendorIdNum != null && !Number.isInteger(vendorIdNum)) {
      return res.status(400).json({ success: false, message: "vendorId must be a number when provided" });
    }

    const location = await prisma.inventoryLocation.findUnique({
      where: { id: locId },
      include: { branch: true },
    });
    if (!location) return res.status(404).json({ success: false, message: "Location not found" });
    const orgId = location.branch.orgId;
    const member = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
    const isOwner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId } });
    if (!member && !isOwner) return res.status(403).json({ success: false, message: "Not authorized for this org" });

    const payload = {
      orgId,
      vendorId: vendorIdNum ?? undefined,
      locationId: locId,
      invoiceNo: invoiceNo != null ? String(invoiceNo).trim() || undefined : undefined,
      invoiceDate: invoiceDate || undefined,
      notes: notes != null ? String(notes) : undefined,
      lines: lines.map((l) => ({
        variantId: parseInt(l.variantId, 10),
        quantity: parseInt(l.quantity, 10) || 0,
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        lotCode: l.lotCode != null ? String(l.lotCode) : undefined,
        mfgDate: l.mfgDate || undefined,
        expDate: l.expDate || undefined,
      })),
    };
    const grn = await grnService.createAndReceiveGrn(payload, userId);
    return res.status(201).json({ success: true, data: grn, message: "Bulk receipt received" });
  } catch (e: any) {
    console.error("createBulkReceipt error:", e);
    if (e?.code === "BULK_RECEIVE_VALIDATION" && Array.isArray(e.errors)) {
      return res.status(400).json({ success: false, message: e.message || "Validation failed", errors: e.errors });
    }
    return res.status(400).json({ success: false, message: (e && e.message) || "Bulk receipt failed" });
  }
};

/**
 * GET /api/v1/inventory/:id
 * Get single inventory item (composite id: loc-{locationId}-var-{variantId})
 */
exports.getInventoryItem = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const idStr = req.params.id;
    const match = idStr && idStr.match(/^loc-(\d+)-var-(\d+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: "Use composite id loc-{locationId}-var-{variantId}" });
    }
    const [, locationId, variantId] = match;
    const balance = await ledgerService.getStockBalance(parseInt(locationId), parseInt(variantId));
    const lots = await service.getInventoryLots({ locationId: parseInt(locationId), variantId: parseInt(variantId) });
    return res.status(200).json({
      success: true,
      data: { ...balance, lots },
    });
  } catch (error) {
    console.error("getInventoryItem error:", error);
    return res.status(500).json({
      success: false,
      message: (error as Error).message || "Failed to get inventory item",
    });
  }
};

/**
 * POST /api/v1/inventory
 * Create or update inventory
 */
exports.upsertInventory = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, productId, variantId, quantity, minStock, expiryDate } = req.body;

    if (!branchId || !productId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "branchId, productId, and quantity are required",
      });
    }

    // Verify user has access to branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, branchId: branchId, status: "ACTIVE" },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
      });
    }

    const inventory = await service.upsertInventory({
      branchId: parseInt(branchId),
      productId: parseInt(productId),
      variantId: variantId ? parseInt(variantId) : undefined,
      quantity: parseInt(quantity),
      minStock: minStock ? parseInt(minStock) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: inventory,
      message: "Inventory updated successfully",
    });
  } catch (error) {
    console.error("upsertInventory error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update inventory",
    });
  }
};

/**
 * POST /api/v1/inventory/:id/adjust
 * Adjust stock (add/remove/adjust)
 */
exports.adjustStock = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const inventoryId = parseInt(req.params.id);
    if (!inventoryId) {
      return res.status(400).json({ success: false, message: "Invalid inventory ID" });
    }

    const { type, quantity, reason } = req.body;

    if (!type || !["IN", "OUT", "ADJUST"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be IN, OUT, or ADJUST",
      });
    }

    if (quantity === undefined || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a positive number",
      });
    }

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const updated = await service.adjustStock(
      inventoryId,
      {
        type: type,
        quantity: parseInt(quantity),
        reason: reason,
        createdByUserId: userId,
      },
      branchId
    );

    return res.status(200).json({
      success: true,
      data: updated,
      message: "Stock adjusted successfully",
    });
  } catch (error) {
    console.error("adjustStock error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to adjust stock",
    });
  }
};

/**
 * POST /api/v1/inventory/:id/transfer
 * Transfer stock to another branch
 */
exports.transferStock = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const inventoryId = parseInt(req.params.id);
    if (!inventoryId) {
      return res.status(400).json({ success: false, message: "Invalid inventory ID" });
    }

    const { toBranchId, quantity, reason } = req.body;

    if (!toBranchId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "toBranchId and quantity are required",
      });
    }

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const result = await service.transferStock(
      inventoryId,
      {
        toBranchId: parseInt(toBranchId),
        quantity: parseInt(quantity),
        reason: reason,
        createdByUserId: userId,
      },
      branchId
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("transferStock error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to transfer stock",
    });
  }
};

/**
 * GET /api/v1/inventory/alerts
 * Get low stock alerts (v2 ledger-based)
 */
exports.getLowStockAlerts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    });
    const branchId = branchMember?.branchId || (req.query.branchId ? parseInt(req.query.branchId) : undefined);
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;

    const alerts = await service.getLowStockAlertsV2({ branchId, locationId });
    return res.status(200).json({ success: true, data: alerts });
  } catch (error) {
    console.error("getLowStockAlerts error:", error);
    return res.status(500).json({
      success: false,
      message: (error as Error).message || "Failed to get alerts",
    });
  }
};

/**
 * GET /api/v1/inventory/expiring
 * Get expiring items (v2 lot-based)
 */
exports.getExpiringItems = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchMember = await prisma.branchMember.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { branchId: true },
    });
    const ownerOrg = await prisma.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const branchId = branchMember?.branchId || (req.query.branchId ? parseInt(req.query.branchId) : undefined);
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    const orgId = ownerOrg?.id || (req.query.orgId ? parseInt(req.query.orgId) : undefined);
    const daysAhead = parseInt(req.query.daysAhead) || 30;

    const items = await service.getExpiringItemsV2({ branchId, locationId, orgId, daysAhead });
    return res.status(200).json({ success: true, data: items });
  } catch (error) {
    console.error("getExpiringItems error:", error);
    return res.status(500).json({
      success: false,
      message: (error as Error).message || "Failed to get expiring items",
    });
  }
};

/**
 * GET /api/v1/inventory/balance
 * Get stock balance (location-based, new products module)
 */
exports.getStockBalance = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;

    if (!locationId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "locationId and variantId are required",
      });
    }

    const balance = await ledgerService.getStockBalance(locationId, variantId);

    return res.status(200).json({
      success: true,
      data: balance,
    });
  } catch (error) {
    console.error("getStockBalance error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get stock balance",
    });
  }
};

/**
 * POST /api/v1/inventory/opening
 * Create opening stock (OPENING ledger entry, requires lot)
 * Body: locationId, variantId, quantity, and either:
 *   - lotId (existing lot) OR
 *   - orgId, lotCode, mfgDate, expDate (create new lot)
 */
exports.createOpeningStock = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { locationId, variantId, quantity, lotId, orgId, lotCode, mfgDate, expDate } = req.body;

    if (!locationId || !variantId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, quantity are required",
      });
    }
    if (quantity <= 0) {
      return res.status(400).json({ success: false, message: "quantity must be positive" });
    }

    let resolvedLotId: number | null = null;

    if (lotId) {
      const lot = await prisma.stockLot.findUnique({
        where: { id: parseInt(lotId) },
      });
      if (!lot || lot.variantId !== parseInt(variantId)) {
        return res.status(400).json({ success: false, message: "Invalid lotId or variant mismatch" });
      }
      if (lot.expDate && new Date() >= lot.expDate) {
        return res.status(400).json({
          success: false,
          message: `Lot ${lot.lotCode} has expired`,
          code: INVENTORY_ERROR_CODES.LOT_EXPIRED,
        });
      }
      resolvedLotId = lot.id;
    } else if (orgId && lotCode && mfgDate && expDate) {
      const loc = await prisma.inventoryLocation.findUnique({
        where: { id: parseInt(locationId) },
        include: { branch: true },
      });
      if (!loc) return res.status(404).json({ success: false, message: "Location not found" });
      const org = loc.branch.orgId;
      if (org !== parseInt(orgId)) {
        return res.status(400).json({ success: false, message: "orgId must match location's organization" });
      }

      const mfg = new Date(mfgDate);
      const exp = new Date(expDate);
      if (exp <= mfg) {
        return res.status(400).json({
          success: false,
          message: "Expiry date must be after manufacturing date",
        });
      }
      if (new Date() >= exp) {
        return res.status(400).json({
          success: false,
          message: "Lot expiry date must be in the future",
          code: INVENTORY_ERROR_CODES.LOT_EXPIRED,
        });
      }

      let lot = await prisma.stockLot.findFirst({
        where: {
          orgId: org,
          variantId: parseInt(variantId),
          lotCode: String(lotCode).trim(),
        },
      });
      if (!lot) {
        lot = await prisma.stockLot.create({
          data: {
            orgId: org,
            variantId: parseInt(variantId),
            lotCode: String(lotCode).trim(),
            mfgDate: mfg,
            expDate: exp,
            createdByUserId: userId,
          },
        });
      }
      resolvedLotId = lot.id;
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide lotId or (orgId, lotCode, mfgDate, expDate) to create lot",
      });
    }

    const loc = await prisma.inventoryLocation.findUnique({
      where: { id: parseInt(locationId) },
      include: { branch: { select: { orgId: true } } },
    });
    const ledgerOrgId = loc?.branch?.orgId ?? null;

    const ledger = await ledgerService.recordLedgerEntry({
      orgId: ledgerOrgId,
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      lotId: resolvedLotId,
      type: "OPENING",
      quantityDelta: parseInt(quantity),
      createdByUserId: userId,
    });

    const balance = await ledgerService.getStockBalance(
      parseInt(locationId),
      parseInt(variantId)
    );

    return res.status(201).json({
      success: true,
      data: { ledger, balance },
      message: "Opening stock created successfully",
    });
  } catch (error) {
    console.error("createOpeningStock error:", error);
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to create opening stock",
    });
  }
};

/**
 * POST /api/v1/inventory/adjust
 * Adjust stock (ADJUSTMENT ledger entry)
 */
exports.adjustStockNew = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, quantity, reason } = req.body;

    if (!locationId || !variantId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and quantity are required",
      });
    }

    // quantity can be positive (increase) or negative (decrease)
    const ledger = await ledgerService.recordLedgerEntry({
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      type: "ADJUSTMENT",
      quantityDelta: parseInt(quantity),
      refType: "ADJUSTMENT",
      createdByUserId: userId,
    });

    const balance = await ledgerService.getStockBalance(
      parseInt(locationId),
      parseInt(variantId)
    );

    return res.status(200).json({
      success: true,
      data: {
        ledger,
        balance,
      },
      message: "Stock adjusted successfully",
    });
  } catch (error) {
    console.error("adjustStockNew error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to adjust stock",
    });
  }
};

/**
 * GET /api/v1/inventory/dashboard
 * Dashboard cards: totalSkus, lowStockCount, expiringCount. Query: branchId=, locationId=, orgId=
 */
exports.getInventoryDashboard = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = req.query.branchId ? parseInt(String(req.query.branchId), 10) : undefined;
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    const orgId = req.query.orgId ? parseInt(String(req.query.orgId), 10) : undefined;
    const data = await service.getInventoryDashboardCards({ branchId, locationId, orgId });
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error("getInventoryDashboard error:", e);
    return res.status(500).json({ success: false, message: (e && (e as Error).message) || "Failed" });
  }
};

/**
 * GET /api/v1/inventory/valuation
 * Stock valuation (FIFO or Weighted Average). Query: locationId=, variantId=, method=FIFO|WEIGHTED_AVG
 */
exports.getValuation = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    if (!locationId) return res.status(400).json({ success: false, message: "locationId required" });
    const variantId = req.query.variantId ? parseInt(String(req.query.variantId), 10) : undefined;
    const method = req.query.method === "FIFO" ? "FIFO" : "WEIGHTED_AVG";
    const result = await service.getValuation({ locationId, variantId, method });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("getValuation error:", e);
    return res.status(500).json({ success: false, message: (e && e.message) || "Valuation failed" });
  }
};

/**
 * GET /api/v1/inventory/variants/search
 * Searchable product/variant picker for bulk receive. Query: q=, orgId=, limit=, page=
 * Resolves orgIds from user (owner orgs + member orgs).
 */
exports.getVariantsSearch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const ownerOrgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const memberOrgs = await prisma.orgMember.findMany({
      where: { userId, status: "ACTIVE" },
      select: { orgId: true },
    });
    const orgIds = [...new Set([...ownerOrgs.map((o) => o.id), ...memberOrgs.map((m) => m.orgId)])];
    if (orgIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    const orgIdFilter = req.query.orgId ? [parseInt(String(req.query.orgId), 10)].filter(Number.isInteger) : orgIds;
    const effectiveOrgIds = req.query.orgId ? orgIds.filter((id) => orgIdFilter.includes(id)) : orgIds;
    const result = await service.getVariantsSearch({
      orgIds: effectiveOrgIds,
      q: req.query.q as string | undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e) {
    console.error("getVariantsSearch error:", e);
    return res.status(500).json({ success: false, message: (e && e.message) || "Search failed" });
  }
};

/**
 * GET /api/v1/inventory/ledger
 * Ledger history for audit UIs. Query: locationId, variantId, lotId, type, refType, refId, page, limit
 */
exports.getInventoryLedger = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;
    const lotId = req.query.lotId ? parseInt(req.query.lotId) : undefined;
    const type = req.query.type as string | undefined;
    const refType = req.query.refType as string | undefined;
    const refId = req.query.refId as string | undefined;
    const page = req.query.page ? parseInt(req.query.page) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit) : undefined;

    const result = await ledgerService.getLedgerHistory({
      locationId,
      variantId,
      lotId,
      type,
      refType,
      refId,
      page,
      limit,
    });

    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e) {
    console.error("getInventoryLedger error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/**
 * GET /api/v1/inventory/reports/stock-balance
 * Current stock by location (optional variantId, locationId, orgId)
 */
exports.getReportsStockBalance = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await service.getStockBalanceReport({
      locationId: req.query.locationId ? parseInt(req.query.locationId) : undefined,
      variantId: req.query.variantId ? parseInt(req.query.variantId) : undefined,
      orgId: req.query.orgId ? parseInt(req.query.orgId) : undefined,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("getReportsStockBalance error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/**
 * GET /api/v1/inventory/reports/stock-by-lot-expiry
 * By lot with expiry buckets: 0-30, 31-90, 90+ days
 */
exports.getReportsStockByLotExpiry = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const result = await service.getStockByLotExpiryReport({
      locationId: req.query.locationId ? parseInt(req.query.locationId) : undefined,
      variantId: req.query.variantId ? parseInt(req.query.variantId) : undefined,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("getReportsStockByLotExpiry error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/**
 * GET /api/v1/inventory/fefo
 * FEFO helper: available lots by earliest expiry (excludes expired)
 * Query: locationId, variantId (both required)
 */
exports.getFefoLots = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId as string) : undefined;
    if (!locationId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "locationId and variantId are required",
      });
    }
    const lots = await ledgerService.getAvailableLotsFEFO(locationId, variantId);
    return res.status(200).json({ success: true, data: lots });
  } catch (e) {
    console.error("getFefoLots error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/**
 * POST /api/v1/inventory/pos-sale
 * Record POS sale (FEFO: SALE_POS ledger entries by earliest expiry first, expired blocked)
 */
exports.recordPosSale = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, quantity, refType, refId } = req.body;

    if (!locationId || !variantId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and quantity are required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be positive",
      });
    }

    const ledgerIds = await ledgerService.saleFEFO({
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      quantity: parseInt(quantity),
      saleType: "SALE_POS",
      refType: refType || "POS_SALE",
      refId: refId || null,
      createdByUserId: userId,
    });

    const balance = await ledgerService.getStockBalance(
      parseInt(locationId),
      parseInt(variantId)
    );

    return res.status(200).json({
      success: true,
      data: {
        ledgerIds,
        balance,
      },
      message: "POS sale recorded successfully (FEFO)",
    });
  } catch (error) {
    console.error("recordPosSale error:", error);
    const code = (error as any).code;
    if (code === INVENTORY_ERROR_CODES.LOT_EXPIRED) {
      return res.status(400).json({
        success: false,
        message: (error as Error).message,
        code: INVENTORY_ERROR_CODES.LOT_EXPIRED,
      });
    }
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to record POS sale",
    });
  }
};

/**
 * POST /api/v1/inventory/online-reserve
 * Reserve stock for online order (RESERVE_ONLINE)
 */
exports.reserveOnlineStock = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, quantity, refType, refId } = req.body;

    if (!locationId || !variantId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and quantity are required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be positive",
      });
    }

    // Verify location is ONLINE_HUB
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: parseInt(locationId) },
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    if (location.type !== "ONLINE_HUB") {
      return res.status(400).json({
        success: false,
        message: "Online reservations can only be made from ONLINE_HUB locations",
      });
    }

    const ledger = await ledgerService.recordLedgerEntry({
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      type: "RESERVE_ONLINE",
      quantityDelta: parseInt(quantity), // Positive for reserve
      refType: refType || "CART",
      refId: refId || null,
      createdByUserId: userId,
    });

    const balance = await ledgerService.getStockBalance(
      parseInt(locationId),
      parseInt(variantId)
    );

    return res.status(200).json({
      success: true,
      data: {
        ledger,
        balance,
      },
      message: "Stock reserved successfully",
    });
  } catch (error) {
    console.error("reserveOnlineStock error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to reserve stock",
    });
  }
};

/**
 * POST /api/v1/inventory/online-sale
 * Commit online sale (SALE_ONLINE + RELEASE_RESERVE)
 */
exports.commitOnlineSale = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, quantity, refType, refId } = req.body;

    if (!locationId || !variantId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and quantity are required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be positive",
      });
    }

    // Verify location is ONLINE_HUB
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: parseInt(locationId) },
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    if (location.type !== "ONLINE_HUB") {
      return res.status(400).json({
        success: false,
        message: "Online sales can only be committed from ONLINE_HUB locations",
      });
    }

    // Record both SALE_ONLINE and RELEASE_RESERVE in single transaction
    const ledgerIds = await ledgerService.recordMultipleLedgerEntries([
      {
        locationId: parseInt(locationId),
        variantId: parseInt(variantId),
        type: "SALE_ONLINE",
        quantityDelta: -parseInt(quantity), // Negative for sale
        refType: refType || "ORDER",
        refId: refId || null,
        createdByUserId: userId,
      },
      {
        locationId: parseInt(locationId),
        variantId: parseInt(variantId),
        type: "RELEASE_RESERVE",
        quantityDelta: -parseInt(quantity), // Negative to release reserved
        refType: refType || "ORDER",
        refId: refId || null,
        createdByUserId: userId,
      },
    ]);

    const balance = await ledgerService.getStockBalance(
      parseInt(locationId),
      parseInt(variantId)
    );

    return res.status(200).json({
      success: true,
      data: {
        ledgerIds,
        balance,
      },
      message: "Online sale committed successfully",
    });
  } catch (error) {
    console.error("commitOnlineSale error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to commit online sale",
    });
  }
};

export {};
