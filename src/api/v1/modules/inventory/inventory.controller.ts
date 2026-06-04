const service = require("./inventory.service");
const ledgerService = require("./ledger.service");
const directDispatchService = require("./directDispatch.service");
const warehouseLocationService = require("./services/warehouseLocation.service");
const stockTransferFacade = require("./services/stockTransfer.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const { getManagedBranchesForUser } = require("../../services/branchManager.service");
const { userCanAccessStockRequestBranch } = require("../stock_requests/stockRequestAccess");
const { auditStockDispatch } = require("./auditHelper");
const { INVENTORY_ERROR_CODES } = require("../../constants/inventoryErrors");
const { logWarehouseAudit, auditMetadataFromRequest } = require("../warehouse/warehouseAudit.service");

/** Legacy transfer vs allocation plan / feature flags — align with stock_requests owner mutations. */
function inventoryLegacyFulfillmentErrorResponse(e: unknown): { status: number; body: Record<string, unknown> } | null {
  const raw = String((e as Error)?.message || "");
  if (raw.startsWith("ALLOCATION_PLAN_BLOCKS_LEGACY:")) {
    return {
      status: 409,
      body: {
        success: false,
        code: "ALLOCATION_PLAN_BLOCKS_LEGACY",
        message: raw.replace(/^ALLOCATION_PLAN_BLOCKS_LEGACY:\s*/, "").trim(),
      },
    };
  }
  if (raw.startsWith("LEGACY_STOCK_REQUEST_FULFILL_DISABLED:")) {
    return {
      status: 403,
      body: {
        success: false,
        code: "LEGACY_STOCK_REQUEST_FULFILL_DISABLED",
        message: raw.replace(/^LEGACY_STOCK_REQUEST_FULFILL_DISABLED:\s*/, "").trim(),
      },
    };
  }
  if (raw.startsWith("LEGACY_STOCK_TRANSFER_DISABLED:")) {
    return {
      status: 403,
      body: {
        success: false,
        code: "LEGACY_STOCK_TRANSFER_DISABLED",
        message: raw.replace(/^LEGACY_STOCK_TRANSFER_DISABLED:\s*/, "").trim(),
      },
    };
  }
  return null;
}

/**
 * Strip cost-related fields from response data for non-owner roles.
 * Owner/warehouse managers can see cost; branch staff cannot.
 */
function stripCostFields(data: any, userRole: "OWNER" | "WAREHOUSE" | "BRANCH"): any {
  if (userRole === "OWNER" || userRole === "WAREHOUSE") {
    return data;
  }
  // For branch roles, recursively strip unitCost and cost fields
  if (Array.isArray(data)) {
    return data.map((item) => stripCostFields(item, userRole));
  }
  if (data && typeof data === "object") {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "unitCost" || key === "cost" || key === "avgCost") {
        continue; // Skip cost fields
      }
      cleaned[key] = stripCostFields(value, userRole);
    }
    return cleaned;
  }
  return data;
}

/**
 * Determine user role for cost visibility.
 * OWNER: org owner
 * WAREHOUSE: warehouse manager, receiving/dispatch staff
 * BRANCH: branch manager, seller, clinic staff
 */
async function resolveUserCostVisibilityRole(userId: number, orgId?: number): Promise<"OWNER" | "WAREHOUSE" | "BRANCH"> {
  // Check if owner
  if (orgId) {
    const isOwner = await prisma.organization.findFirst({
      where: { id: orgId, ownerUserId: userId },
      select: { id: true },
    });
    if (isOwner) return "OWNER";
  }

  // Check if owner of any org
  const ownedOrg = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (ownedOrg) return "OWNER";

  // Check warehouse roles via BranchAccessPermission
  const warehousePerms = await prisma.branchAccessPermission.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [
        { role: "WAREHOUSE_MANAGER" },
        { role: "RECEIVING_STAFF" },
        { role: "DISPATCH_STAFF" },
      ]
    },
    select: { id: true },
  });
  if (warehousePerms) return "WAREHOUSE";

  // Default to BRANCH (no cost visibility)
  return "BRANCH";
}

/**
 * Resolve list/dashboard scope: explicit query wins; else owner org (all branches);
 * else staff branch membership.
 */
async function resolveInventoryScope(userId: number, query: Record<string, unknown>) {
  const qBranch = query.branchId ? parseInt(String(query.branchId), 10) : NaN;
  const qLocation = query.locationId ? parseInt(String(query.locationId), 10) : NaN;
  const branchId = Number.isFinite(qBranch) && qBranch > 0 ? qBranch : undefined;
  const locationId = Number.isFinite(qLocation) && qLocation > 0 ? qLocation : undefined;

  const ownerOrg = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const branchMember = await prisma.branchMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });

  if (locationId) {
    return { locationId, branchId, orgId: undefined as number | undefined };
  }
  if (branchId) {
    return { branchId, orgId: undefined as number | undefined };
  }
  if (ownerOrg) {
    return { orgId: ownerOrg.id, branchId: undefined as number | undefined };
  }
  return { branchId: branchMember?.branchId, orgId: undefined as number | undefined };
}

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

    const scope = await resolveInventoryScope(userId, req.query as Record<string, unknown>);
    const locationId = scope.locationId;
    const branchId = scope.branchId;
    const orgId = scope.orgId;

    const stockStatus = String(req.query.stockStatus || "").toLowerCase();
    let lowStockOnly = req.query.lowStockOnly === "true";
    let outOfStockOnly = req.query.outOfStockOnly === "true";
    let inStockOnly = false;
    if (stockStatus === "low") lowStockOnly = true;
    if (stockStatus === "out") outOfStockOnly = true;
    if (stockStatus === "in") inStockOnly = true;

    const locScopeRaw = String(req.query.locationScope || "").toLowerCase();
    const locationScope = locScopeRaw === "hub" || locScopeRaw === "branch" ? locScopeRaw : undefined;

    const result = await service.getInventorySummaryV2({
      branchId,
      orgId,
      locationId,
      productId: req.query.productId ? parseInt(String(req.query.productId), 10) : undefined,
      variantId: req.query.variantId ? parseInt(String(req.query.variantId), 10) : undefined,
      search: req.query.search as string | undefined,
      lowStockOnly,
      outOfStockOnly,
      inStockOnly,
      locationScope: locationScope as "hub" | "branch" | undefined,
      page: parseInt(String(req.query.page), 10) || 1,
      limit: parseInt(String(req.query.limit), 10) || 20,
    });

    const items = result.items.map((i: any) => ({
      ...i,
      branch: i.location?.branch || null,
      branchId: i.location?.branch?.id ?? null,
      expiryDate: i.nearestExpiry ?? null,
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

    const scope = await resolveInventoryScope(userId, req.query as Record<string, unknown>);
    const result = await service.getInventorySummaryV2({
      branchId: scope.branchId,
      orgId: scope.orgId,
      locationId: scope.locationId,
      productId: req.query.productId ? parseInt(String(req.query.productId), 10) : undefined,
      variantId: req.query.variantId ? parseInt(String(req.query.variantId), 10) : undefined,
      search: req.query.search as string | undefined,
      lowStockOnly: req.query.lowStockOnly === "true",
      outOfStockOnly: req.query.outOfStockOnly === "true",
      page: parseInt(String(req.query.page), 10) || 1,
      limit: parseInt(String(req.query.limit), 10) || 20,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination, meta: result.meta });
  } catch (e) {
    console.error("getInventorySummary error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

exports.getInventoryLocations = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const raw = req.query?.orgId;
    const parsed = raw != null && String(raw).trim() !== "" ? parseInt(String(raw), 10) : NaN;
    const orgId = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    const whRaw = req.query?.warehouseId;
    const whParsed = whRaw != null && String(whRaw).trim() !== "" ? parseInt(String(whRaw), 10) : NaN;
    const warehouseId = Number.isFinite(whParsed) && whParsed > 0 ? whParsed : undefined;
    const locations = await service.getInventoryLocations(
      userId,
      orgId != null ? { orgId, warehouseId } : warehouseId != null ? { warehouseId } : undefined
    );
    return res.status(200).json({ success: true, data: locations });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG") {
      return res.status(403).json({ success: false, message: (e as Error).message });
    }
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

/**
 * GET /api/v1/inventory/batches — enriched lot rows (flat product/variant, quantities, status).
 * Backward-compatible with /lots: still includes nested `lot`; adds `quantity`, `lotCode`, `expDate`, `product`, `variant`.
 */
exports.getInventoryBatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    if (!locationId) return res.status(400).json({ success: false, message: "locationId required" });
    const hideZeroQty = req.query.hideZeroQty !== "false";
    const excludeExpired = req.query.excludeExpired !== "false";
    const nearExpiryRaw = req.query.nearExpiryDays ? parseInt(String(req.query.nearExpiryDays), 10) : 90;
    const nearExpiryDays = Number.isFinite(nearExpiryRaw) && nearExpiryRaw > 0 ? nearExpiryRaw : 90;
    const variantRaw = req.query.variantId ? parseInt(String(req.query.variantId), 10) : NaN;
    const variantId = Number.isFinite(variantRaw) && variantRaw > 0 ? variantRaw : undefined;

    const rows = await service.getInventoryBatches({
      locationId,
      variantId,
      hideZeroQty,
      excludeExpired,
      nearExpiryDays,
    });

    const loc = await prisma.inventoryLocation.findUnique({
      where: { id: locationId },
      select: { branch: { select: { orgId: true } } },
    });
    const orgId = loc?.branch?.orgId;

    // Apply cost field stripping based on user role
    const userRole = await resolveUserCostVisibilityRole(userId, orgId ?? undefined);
    const cleanedRows = stripCostFields(rows, userRole);

    if (orgId != null) {
      void logWarehouseAudit({
        orgId,
        warehouseId: null,
        category: "OPERATIONS",
        action: "INVENTORY_BATCHES_LIST",
        entityType: "InventoryLocation",
        entityId: String(locationId),
        metadata: { hideZeroQty, excludeExpired, rowCount: rows.length },
        actorUserId: userId,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      data: cleanedRows,
      meta: {
        summary: {
          totalLots: cleanedRows.length,
          activeLots: cleanedRows.filter((r: { status: string }) => r.status === "ACTIVE").length,
          nearExpiry: cleanedRows.filter((r: { status: string }) => r.status === "NEAR_EXPIRY").length,
          expired: cleanedRows.filter((r: { status: string }) => r.status === "EXPIRED").length,
          depleted: cleanedRows.filter((r: { status: string }) => r.status === "DEPLETED").length,
        },
      },
    });
  } catch (e) {
    console.error("getInventoryBatches error:", e);
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

    const {
      locationId,
      vendorId,
      invoiceNo,
      invoiceDate,
      notes,
      lines,
      purchaseOrderId,
      receiveIdempotencyKey,
      postImmediately,
    } = req.body || {};
    const idemFromHeader = req.headers["idempotency-key"] ?? req.headers["Idempotency-Key"];
    const idemKey =
      receiveIdempotencyKey != null && String(receiveIdempotencyKey).trim()
        ? String(receiveIdempotencyKey).trim()
        : idemFromHeader != null && String(idemFromHeader).trim()
          ? String(idemFromHeader).trim()
          : undefined;
    const locId = locationId != null ? parseInt(locationId, 10) : NaN;
    const vendorIdNum = vendorId != null && vendorId !== "" ? parseInt(vendorId, 10) : null;
    const poIdNum =
      purchaseOrderId != null && purchaseOrderId !== "" ? parseInt(String(purchaseOrderId), 10) : null;
    if (poIdNum != null && !Number.isInteger(poIdNum)) {
      return res.status(400).json({ success: false, message: "purchaseOrderId must be a valid integer when provided" });
    }
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

    // PO-linked vendor inbound (GRN against a purchase order): the receiving destination is whatever
    // warehouse/DC the PO targets. Skip internal-dispatch gate entirely — this is NOT a branch transfer.
    // For generic (non-PO) bulk receive, keep the CENTRAL_WAREHOUSE-only guard so that accidental
    // direct receive into branch stores still routes through the dispatch confirmation flow.
    const isPOLinkedInbound = poIdNum != null;
    if (!isPOLinkedInbound) {
      const allowedTypes = ["CENTRAL_WAREHOUSE"];
      if (!allowedTypes.includes(location.type)) {
        return res.status(400).json({
          success: false,
          code: "BRANCH_LOCATION_REQUIRES_DISPATCH",
          message: "Branch locations require dispatch confirmation. Create dispatch instead?",
          payload: { locationType: location.type, locationId: locId, suggestedAction: "CREATE_DISPATCH" },
        });
      }
    }
    const orgId = location.branch.orgId;
    const member = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
    const isOwner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId } });
    if (!member && !isOwner) return res.status(403).json({ success: false, message: "Not authorized for this org" });

    const postImmediatelyBool = postImmediately === true;
    if (postImmediatelyBool) {
      const rawPerms = req.user?.permissions || req.user?.perms || [];
      const permSet = new Set(Array.isArray(rawPerms) ? rawPerms.map((p: string) => String(p)) : []);
      const canImmediate =
        permSet.has("global.admin") ||
        permSet.has("grn.confirm.warehouse_manager") ||
        permSet.has("inventory.emergency.override");
      if (!canImmediate) {
        return res.status(403).json({
          success: false,
          code: "BULK_POST_IMMEDIATE_DENIED",
          message: "postImmediately requires grn.confirm.warehouse_manager (or emergency override). Save as draft instead.",
        });
      }
    }

    const payload = {
      orgId,
      vendorId: vendorIdNum ?? undefined,
      purchaseOrderId: poIdNum != null ? poIdNum : undefined,
      locationId: locId,
      invoiceNo: invoiceNo != null ? String(invoiceNo).trim() || undefined : undefined,
      invoiceDate: invoiceDate || undefined,
      notes: notes != null ? String(notes) : undefined,
      receiveIdempotencyKey: idemKey,
      lines: lines.map((l: any) => ({
        variantId: parseInt(l.variantId, 10),
        quantity: parseInt(l.quantity, 10) || 0,
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        lotCode: l.lotCode != null ? String(l.lotCode) : undefined,
        mfgDate: l.mfgDate || undefined,
        expDate: l.expDate || undefined,
        purchaseOrderLineId: l.purchaseOrderLineId != null ? parseInt(String(l.purchaseOrderLineId), 10) : undefined,
        quantityDamaged: l.quantityDamaged != null ? parseInt(String(l.quantityDamaged), 10) : undefined,
        quantityShort: l.quantityShort != null ? parseInt(String(l.quantityShort), 10) : undefined,
        quantityExtra: l.quantityExtra != null ? parseInt(String(l.quantityExtra), 10) : undefined,
        supplierBarcode: l.supplierBarcode != null ? String(l.supplierBarcode) : undefined,
        receiveBarcode: l.receiveBarcode != null ? String(l.receiveBarcode) : undefined,
        landedUnitCost: l.landedUnitCost != null ? Number(l.landedUnitCost) : undefined,
        lineRemarks: l.lineRemarks != null ? String(l.lineRemarks) : undefined,
        lineDiscrepancyNote: l.lineDiscrepancyNote != null ? String(l.lineDiscrepancyNote) : undefined,
      })),
    };
    const grn = await grnService.createAndReceiveGrn(payload, userId, { postImmediately: postImmediatelyBool });
    return res.status(201).json({
      success: true,
      data: grn,
      message: postImmediatelyBool
        ? "Bulk receipt received and posted to stock"
        : "Bulk receipt saved as draft. Submit for confirmation, then a manager posts the GRN.",
      requiresManagerConfirmation: !postImmediatelyBool,
    });
  } catch (e: any) {
    console.error("createBulkReceipt error:", e);
    if (e?.code === "BULK_RECEIVE_VALIDATION" && Array.isArray(e.errors)) {
      return res.status(400).json({ success: false, message: e.message || "Validation failed", errors: e.errors });
    }
    return res.status(400).json({ success: false, message: (e && e.message) || "Bulk receipt failed" });
  }
};

/**
 * POST /api/v1/inventory/receipts/bulk-override
 * Emergency owner override for bulk receive when warehouse staff unavailable.
 * Requires explicit inventory.emergency.override permission and logs audit trail.
 */
exports.createBulkReceiptOverride = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { reason, ...bulkReceiptBody } = req.body || {};
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Override reason required for audit trail"
      });
    }

    // Log the override usage before processing
    const { locationId } = bulkReceiptBody;
    const locId = locationId != null ? parseInt(locationId, 10) : NaN;
    if (Number.isInteger(locId)) {
      const location = await prisma.inventoryLocation.findUnique({
        where: { id: locId },
        include: { branch: true },
      });
      if (location) {
        await logWarehouseAudit({
          orgId: location.branch.orgId,
          warehouseId: null, // May not have direct warehouse link
          category: "SECURITY",
          action: "OWNER_RECEIVE_OVERRIDE_USED",
          entityType: "BulkReceipt",
          entityId: null, // Will be set after GRN creation
          metadata: {
            reason: reason.trim(),
            locationId: locId,
            locationName: location.name,
            overrideType: "EMERGENCY_BULK_RECEIVE"
          },
          actorUserId: userId,
        });
      }
    }

    // Use the same logic as createBulkReceipt but with override context
    const result = await exports.createBulkReceipt(req, res);
    return result;
  } catch (e: any) {
    console.error("createBulkReceiptOverride error:", e);
    return res.status(400).json({
      success: false,
      message: (e && e.message) || "Override bulk receipt failed"
    });
  }
};

/**
 * POST /api/v1/inventory/direct-dispatch
 * Owner direct dispatch: create StockRequest + StockDispatch from bulk receive lines.
 */
exports.createDirectDispatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { fromLocationId, toLocationId, lines, reference, note } = req.body || {};
    const fromId = fromLocationId != null ? parseInt(fromLocationId, 10) : NaN;
    const toId = toLocationId != null ? parseInt(toLocationId, 10) : NaN;
    if (!Number.isInteger(fromId) || !Number.isInteger(toId) || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: "fromLocationId, toLocationId, and non-empty lines required" });
    }
    const fromLocation = await prisma.inventoryLocation.findUnique({
      where: { id: fromId },
      include: { branch: true },
    });
    if (!fromLocation) return res.status(404).json({ success: false, message: "Source location not found" });
    const orgId = fromLocation.branch.orgId;
    const toLocation = await prisma.inventoryLocation.findUnique({
      where: { id: toId },
      include: { branch: true },
    });
    if (!toLocation) return res.status(404).json({ success: false, message: "Destination location not found" });
    if (toLocation.branch.orgId !== orgId) {
      return res.status(400).json({
        success: false,
        code: "DIRECT_DISPATCH_ORG_MISMATCH",
        message: "Source and destination must belong to the same organization.",
        sourceOrgId: orgId,
        destinationOrgId: toLocation.branch.orgId,
        sourceLocationId: fromId,
        toLocationId: toId,
      });
    }
    const isOwner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId } });
    const member = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
    if (!isOwner && !member) return res.status(403).json({ success: false, message: "Not authorized for this org" });
    const parsedLines = lines
      .map((l: any) => ({ variantId: parseInt(l.variantId, 10), quantity: parseInt(l.quantity, 10) || 0 }))
      .filter((l: { variantId: number; quantity: number }) => Number.isFinite(l.variantId) && l.variantId > 0 && l.quantity > 0);
    if (parsedLines.length === 0) {
      return res.status(400).json({ success: false, message: "At least one valid line (variantId, quantity > 0) required" });
    }
    const result = await directDispatchService.createDirectDispatch({
      orgId,
      fromLocationId: fromId,
      toLocationId: toId,
      lines: parsedLines,
      reference: reference != null ? String(reference).trim() || undefined : undefined,
      note: note != null ? String(note).trim() || undefined : undefined,
      actorUserId: userId,
    });
    await auditStockDispatch(req, "OWNER_DIRECT_DISPATCH_CREATED", result.dispatchId, null, {
      status: result.dispatch?.status,
      stockRequestId: result.stockRequestId,
    });
    const { notifyDispatchCreated } = require("../dispatches/dispatches.notifications");
    await notifyDispatchCreated({
      dispatchId: result.dispatchId,
      dispatch: result.dispatch,
      toBranchId: result.dispatch?.toLocation?.branchId ?? null,
    });
    return res.status(201).json({
      success: true,
      data: { dispatchId: result.dispatchId, stockRequestId: result.stockRequestId, dispatch: result.dispatch },
      message: "Dispatch created. Waiting for branch confirmation.",
    });
  } catch (e: any) {
    console.error("createDirectDispatch error:", e);
    const DirectDispatchAllocationError = directDispatchService.DirectDispatchAllocationError;
    const isAlloc =
      (DirectDispatchAllocationError && e instanceof DirectDispatchAllocationError) ||
      (e?.code === "INSUFFICIENT_STOCK_AT_SOURCE" && e?.details);
    if (isAlloc && e.details) {
      const d = e.details;
      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_STOCK_AT_SOURCE",
        message: e.message,
        orgId: d.orgId,
        sourceLocationId: d.sourceLocationId,
        variantId: d.variantId,
        requestedQty: d.requestedQty,
        availableQty: d.availableQty,
        shortfallQty: d.shortfallQty,
      });
    }
    return res.status(400).json({ success: false, message: (e && e.message) || "Direct dispatch failed" });
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
    let branchId = req.query.branchId ? parseInt(String(req.query.branchId), 10) : undefined;
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    let orgId = req.query.orgId ? parseInt(String(req.query.orgId), 10) : undefined;
    if (!branchId && !locationId && !orgId) {
      const scope = await resolveInventoryScope(userId, req.query as Record<string, unknown>);
      branchId = scope.branchId;
      orgId = scope.orgId;
    }
    const locScopeRaw = String(req.query.locationScope || "").toLowerCase();
    const locationScope = locScopeRaw === "hub" || locScopeRaw === "branch" ? locScopeRaw : undefined;
    const data = await service.getInventoryDashboardCards({
      branchId: Number.isFinite(branchId as number) ? branchId : undefined,
      locationId: Number.isFinite(locationId as number) ? locationId : undefined,
      orgId: Number.isFinite(orgId as number) ? orgId : undefined,
      locationScope: locationScope as "hub" | "branch" | undefined,
    });
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
 * Searchable product/variant picker for bulk receive. Query: q=, orgId=, limit=, page=, variantId= (resolve one row for hydration when q is empty)
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
    const catRaw = req.query.categoryId != null ? parseInt(String(req.query.categoryId), 10) : NaN;
    const brandRaw = req.query.brandId != null ? parseInt(String(req.query.brandId), 10) : NaN;
    const variantActive = String(req.query.variantActive || "").toLowerCase();
    const variantIdRaw = req.query.variantId != null ? parseInt(String(req.query.variantId), 10) : NaN;
    const variantId = Number.isFinite(variantIdRaw) && variantIdRaw > 0 ? variantIdRaw : undefined;
    const result = await service.getVariantsSearch({
      orgIds: effectiveOrgIds,
      q: req.query.q as string | undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
      categoryId: Number.isFinite(catRaw) && catRaw > 0 ? catRaw : undefined,
      brandId: Number.isFinite(brandRaw) && brandRaw > 0 ? brandRaw : undefined,
      variantActiveOnly: variantActive === "all" ? false : true,
      variantId,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e) {
    console.error("getVariantsSearch error:", e);
    return res.status(500).json({ success: false, message: (e && e.message) || "Search failed" });
  }
};

/**
 * GET /api/v1/inventory/stock-request-products
 * Product picker for stock request creation with batch/expiry intelligence.
 * Query: branchId (required), search, page, limit, sort, stockStatus
 */
exports.getStockRequestProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = req.query.branchId ? parseInt(String(req.query.branchId), 10) : undefined;
    if (!branchId) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const branchRow = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { orgId: true },
    });
    if (!branchRow) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    const qOrgRaw = req.query.orgId;
    if (qOrgRaw != null && String(qOrgRaw).trim() !== "") {
      const qOrg = parseInt(String(qOrgRaw), 10);
      if (Number.isFinite(qOrg) && qOrg > 0 && qOrg !== branchRow.orgId) {
        return res.status(400).json({
          success: false,
          message: "orgId does not match this branch's organization",
        });
      }
    }
    const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const gate = await userCanAccessStockRequestBranch(userId, branchId, perms);
    if (!gate.ok) {
      return res.status(403).json({
        success: false,
        message: "Not authorized for this branch",
        code: "STOCK_REQUEST_BRANCH_FORBIDDEN",
      });
    }

    const result = await service.getStockRequestProducts({
      branchId,
      userId,
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      sort: req.query.sort as string | undefined,
      stockStatus: req.query.stockStatus as string | undefined,
    });

    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination, meta: result.meta });
  } catch (e) {
    console.error("getStockRequestProducts error:", e);
    return res.status(500).json({ success: false, message: (e && e.message) || "Failed to load products" });
  }
};

/**
 * GET /api/v1/inventory/stock-request-extra-picker
 * Location-aware variant picker for owner fulfill extra lines (same max-dispatch logic as fulfillment).
 * Query: stockRequestId, fromLocationId (required), search, page, limit, includeZeroStock
 */
exports.getStockRequestExtraPicker = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const stockRequestId = req.query.stockRequestId ? parseInt(String(req.query.stockRequestId), 10) : NaN;
    const fromLocationId = req.query.fromLocationId ? parseInt(String(req.query.fromLocationId), 10) : NaN;
    if (!Number.isFinite(stockRequestId) || stockRequestId <= 0 || !Number.isFinite(fromLocationId) || fromLocationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "stockRequestId and fromLocationId are required",
      });
    }

    const includeZeroStock = String(req.query.includeZeroStock || "").toLowerCase() === "true";

    const result = await service.getStockRequestExtraPicker({
      stockRequestId,
      fromLocationId,
      userId,
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      includeZeroStock,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
      meta: result.meta,
    });
  } catch (e: any) {
    if (e?.code === "FORBIDDEN") {
      return res.status(403).json({ success: false, message: e.message || "Forbidden" });
    }
    if (e?.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: e.message || "Not found" });
    }
    console.error("getStockRequestExtraPicker error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load picker" });
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

/**
 * Resolve org for warehouse/stock endpoints: explicit orgId (validated) or default owner/member org.
 */
async function resolveOrgIdForWarehouseEndpoints(userId: number, query: Record<string, unknown>): Promise<number> {
  const raw = query?.orgId;
  const parsed = raw != null && String(raw).trim() !== "" ? parseInt(String(raw), 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    const ok = await service.userCanAccessOrgForLocations(userId, parsed);
    if (!ok) {
      const e = new Error("Not authorized for this organization");
      (e as { code?: string }).code = "FORBIDDEN_ORG";
      throw e;
    }
    return parsed;
  }
  const owned = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owned) return owned.id;
  const m = await prisma.branchMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  if (m?.orgId) return m.orgId;
  const err = new Error("orgId query parameter is required for this user");
  (err as { code?: string }).code = "ORG_REQUIRED";
  throw err;
}

/** GET /api/v1/inventory/warehouses */
exports.listWarehouses = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await resolveOrgIdForWarehouseEndpoints(userId, req.query as Record<string, unknown>);
    const rows = await warehouseLocationService.listWarehousesForOrg(orgId);
    void logWarehouseAudit({
      orgId,
      warehouseId: null,
      category: "OPERATIONS",
      action: "LIST_WAREHOUSES",
      entityType: "Organization",
      entityId: String(orgId),
      metadata: auditMetadataFromRequest(req, { count: rows.length }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(200).json({ success: true, data: rows });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG" || code === "ORG_REQUIRED") {
      return res.status(code === "ORG_REQUIRED" ? 400 : 403).json({
        success: false,
        message: (e as Error).message,
        code,
      });
    }
    console.error("listWarehouses error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/** GET /api/v1/inventory/stock — balances aggregated per location rows for a warehouse */
exports.getWarehouseStock = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await resolveOrgIdForWarehouseEndpoints(userId, req.query as Record<string, unknown>);
    const wh = req.query?.warehouseId ? parseInt(String(req.query.warehouseId), 10) : NaN;
    if (!Number.isFinite(wh) || wh <= 0) {
      return res.status(400).json({ success: false, message: "warehouseId query parameter is required" });
    }
    await warehouseLocationService.assertWarehouseBelongsToOrg(wh, orgId);
    const variantRaw = req.query?.variantId ? parseInt(String(req.query.variantId), 10) : NaN;
    const variantId = Number.isFinite(variantRaw) && variantRaw > 0 ? variantRaw : undefined;
    const page = parseInt(String(req.query.page || "1"), 10) || 1;
    const limit = parseInt(String(req.query.limit || "50"), 10) || 50;
    const result = await warehouseLocationService.listAggregatedStockForWarehouse({
      orgId,
      warehouseId: wh,
      variantId,
      page,
      limit,
    });
    void logWarehouseAudit({
      orgId,
      warehouseId: wh,
      category: "OPERATIONS",
      action: "LIST_WAREHOUSE_STOCK",
      entityType: "Warehouse",
      entityId: String(wh),
      metadata: auditMetadataFromRequest(req, {
        variantId: variantId ?? null,
        rowCount: result.items.length,
      }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG" || code === "ORG_REQUIRED") {
      return res.status(code === "ORG_REQUIRED" ? 400 : 403).json({
        success: false,
        message: (e as Error).message,
        code,
      });
    }
    console.error("getWarehouseStock error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/** POST /api/v1/inventory/stock/in */
exports.postStockIn = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { locationId, variantId, quantity, lotId, unitCost, refType, refId } = req.body || {};
    const lid = locationId != null ? parseInt(String(locationId), 10) : NaN;
    const vid = variantId != null ? parseInt(String(variantId), 10) : NaN;
    const qty = quantity != null ? parseInt(String(quantity), 10) : NaN;
    if (!Number.isFinite(lid) || !Number.isFinite(vid) || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: "locationId, variantId, and positive quantity required" });
    }
    const loc = await prisma.inventoryLocation.findUnique({
      where: { id: lid },
      include: { branch: { select: { orgId: true } } },
    });
    if (!loc?.branch?.orgId) return res.status(404).json({ success: false, message: "Location not found" });
    const orgId = loc.branch.orgId;
    const ok = await service.userCanAccessOrgForLocations(userId, orgId);
    if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

    const ledger = await ledgerService.recordLedgerEntry({
      orgId,
      locationId: lid,
      variantId: vid,
      lotId: lotId != null ? parseInt(String(lotId), 10) : null,
      type: "ADJUSTMENT",
      quantityDelta: qty,
      unitCost: unitCost != null ? Number(unitCost) : undefined,
      refType: refType || "MANUAL_STOCK_IN",
      refId: refId != null ? String(refId) : null,
      createdByUserId: userId,
    });
    void logWarehouseAudit({
      orgId,
      warehouseId: loc.warehouseId,
      category: "OPERATIONS",
      action: "STOCK_IN",
      entityType: "StockLedger",
      entityId: String(ledger.id),
      metadata: auditMetadataFromRequest(req, {
        locationId: lid,
        variantId: vid,
        quantity: qty,
        lotId: lotId ?? null,
        ledgerType: "ADJUSTMENT_IN",
      }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(201).json({ success: true, data: ledger, message: "Stock in recorded" });
  } catch (e: unknown) {
    console.error("postStockIn error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message });
  }
};

/** POST /api/v1/inventory/stock/out */
exports.postStockOut = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { locationId, variantId, quantity, lotId, refType, refId } = req.body || {};
    const lid = locationId != null ? parseInt(String(locationId), 10) : NaN;
    const vid = variantId != null ? parseInt(String(variantId), 10) : NaN;
    const qty = quantity != null ? parseInt(String(quantity), 10) : NaN;
    if (!Number.isFinite(lid) || !Number.isFinite(vid) || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, message: "locationId, variantId, and positive quantity required" });
    }
    const loc = await prisma.inventoryLocation.findUnique({
      where: { id: lid },
      include: { branch: { select: { orgId: true } } },
    });
    if (!loc?.branch?.orgId) return res.status(404).json({ success: false, message: "Location not found" });
    const orgId = loc.branch.orgId;
    const ok = await service.userCanAccessOrgForLocations(userId, orgId);
    if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

    const ledger = await ledgerService.recordLedgerEntry({
      orgId,
      locationId: lid,
      variantId: vid,
      lotId: lotId != null ? parseInt(String(lotId), 10) : null,
      type: "ADJUSTMENT",
      quantityDelta: -qty,
      refType: refType || "MANUAL_STOCK_OUT",
      refId: refId != null ? String(refId) : null,
      createdByUserId: userId,
    });
    void logWarehouseAudit({
      orgId,
      warehouseId: loc.warehouseId,
      category: "OPERATIONS",
      action: "STOCK_OUT",
      entityType: "StockLedger",
      entityId: String(ledger.id),
      metadata: auditMetadataFromRequest(req, {
        locationId: lid,
        variantId: vid,
        quantity: qty,
        lotId: lotId ?? null,
        ledgerType: "ADJUSTMENT_OUT",
      }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(201).json({ success: true, data: ledger, message: "Stock out recorded" });
  } catch (e: unknown) {
    console.error("postStockOut error:", e);
    return res.status(400).json({ success: false, message: (e as Error).message });
  }
};

/** POST /api/v1/inventory/transfers — draft transfer (same item shape as /api/v1/transfers) */
exports.createInventoryTransfer = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { fromLocationId, toLocationId, items, allocations } = req.body || {};
    const rawItems = allocations || items;
    if (!fromLocationId || !toLocationId || !rawItems?.length) {
      return res.status(400).json({
        success: false,
        message: "fromLocationId, toLocationId, and items[] are required",
      });
    }
    const parsed = rawItems.map((a: any) => {
      const lotId = a.lotId != null ? parseInt(String(a.lotId), 10) : null;
      const variantId = parseInt(String(a.variantId), 10);
      const quantity = parseInt(String(a.quantity), 10);
      if (!variantId || !quantity || quantity <= 0) {
        throw new Error("Each item needs variantId and positive quantity");
      }
      return {
        lotId,
        variantId,
        quantity,
        stockRequestItemId: a.stockRequestItemId != null ? parseInt(String(a.stockRequestItemId), 10) : null,
      };
    });
    const fromLoc = await prisma.inventoryLocation.findUnique({
      where: { id: parseInt(String(fromLocationId), 10) },
      include: { branch: { select: { orgId: true } } },
    });
    if (!fromLoc?.branch?.orgId) {
      return res.status(404).json({ success: false, message: "Source location not found" });
    }
    const ok = await service.userCanAccessOrgForLocations(userId, fromLoc.branch.orgId);
    if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

    const transfer = await stockTransferFacade.createDraftTransfer({
      fromLocationId: parseInt(String(fromLocationId), 10),
      toLocationId: parseInt(String(toLocationId), 10),
      items: parsed,
      createdByUserId: userId,
    });
    void logWarehouseAudit({
      orgId: fromLoc.branch.orgId,
      warehouseId: fromLoc.warehouseId,
      category: "OPERATIONS",
      action: "TRANSFER_CREATE",
      entityType: "StockTransfer",
      entityId: String(transfer.id),
      metadata: auditMetadataFromRequest(req, {
        toLocationId: parseInt(String(toLocationId), 10),
        lineCount: parsed.length,
      }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(201).json({ success: true, data: transfer, message: "Transfer created" });
  } catch (e: unknown) {
    console.error("createInventoryTransfer error:", e);
    const mapped = inventoryLegacyFulfillmentErrorResponse(e);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    return res.status(400).json({ success: false, message: (e as Error).message });
  }
};

/** POST /api/v1/inventory/transfers/:id/dispatch — alias for send (IN_TRANSIT) */
exports.dispatchInventoryTransfer = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const transferId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(transferId) || transferId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid transfer id" });
    }
    const t = await prisma.stockTransfer.findUnique({
      where: { id: transferId },
      include: { fromLocation: { include: { branch: { select: { orgId: true } } } } },
    });
    if (!t) return res.status(404).json({ success: false, message: "Transfer not found" });
    const orgId = t.fromLocation?.branch?.orgId;
    if (orgId == null) return res.status(400).json({ success: false, message: "Invalid transfer location" });
    const ok = await service.userCanAccessOrgForLocations(userId, orgId);
    if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });

    const result = await stockTransferFacade.sendTransfer(transferId, userId);
    void logWarehouseAudit({
      orgId,
      warehouseId: t.fromLocation?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "TRANSFER_DISPATCH",
      entityType: "StockTransfer",
      entityId: String(transferId),
      metadata: auditMetadataFromRequest(req, {
        stockRequestId: t.stockRequestId ?? null,
        ledgerIds: (result as { ledgerIds?: number[] })?.ledgerIds ?? [],
      }),
      actorUserId: userId,
    }).catch(() => {});
    return res.status(200).json({ success: true, data: result, message: "Transfer dispatched" });
  } catch (e: unknown) {
    console.error("dispatchInventoryTransfer error:", e);
    const mapped = inventoryLegacyFulfillmentErrorResponse(e);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    const code = (e as any)?.code;
    if (code === "LOT_EXPIRED" || code === INVENTORY_ERROR_CODES.LOT_EXPIRED) {
      return res.status(400).json({ success: false, message: (e as Error).message, code });
    }
    return res.status(400).json({ success: false, message: (e as Error).message });
  }
};

const operationsVisibility = require("../../services/operationsVisibility.service");

/** GET /api/v1/inventory/operations/exception-summary — queues & discrepancy counts for dashboards */
exports.getOperationsExceptionSummary = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await resolveOrgIdForWarehouseEndpoints(userId, req.query as Record<string, unknown>);
    const data = await operationsVisibility.getOperationsExceptionSummary(orgId);
    return res.status(200).json({ success: true, data });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG" || code === "ORG_REQUIRED") {
      return res.status(code === "ORG_REQUIRED" ? 400 : 403).json({
        success: false,
        message: (e as Error).message,
        code,
      });
    }
    console.error("getOperationsExceptionSummary error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/** GET /api/v1/inventory/operations/pending-confirmations — detail rows for confirmation queues */
exports.getOperationsPendingDetails = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await resolveOrgIdForWarehouseEndpoints(userId, req.query as Record<string, unknown>);
    const limit = Math.min(parseInt(String(req.query.limit || "25"), 10) || 25, 100);
    const data = await operationsVisibility.listPendingConfirmationDetails(orgId, limit);
    return res.status(200).json({ success: true, data });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG" || code === "ORG_REQUIRED") {
      return res.status(code === "ORG_REQUIRED" ? 400 : 403).json({
        success: false,
        message: (e as Error).message,
        code,
      });
    }
    console.error("getOperationsPendingDetails error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/** GET /api/v1/inventory/lookup/variant-by-barcode?barcode= — org-scoped variant for receive / scan flows */
exports.lookupVariantByBarcode = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await resolveOrgIdForWarehouseEndpoints(userId, req.query as Record<string, unknown>);
    const barcode = String((req.query as Record<string, string>)?.barcode || "").trim();
    if (!barcode) {
      return res.status(400).json({ success: false, message: "barcode query parameter is required" });
    }
    const v = await prisma.productVariant.findFirst({
      where: {
        barcode,
        isActive: true,
        product: { orgId, status: "ACTIVE" },
      },
      select: {
        id: true,
        sku: true,
        title: true,
        productId: true,
        barcode: true,
        product: { select: { id: true, name: true } },
      },
    });
    if (!v) {
      return res.status(404).json({ success: false, message: "No active variant found for this barcode in your catalog" });
    }
    return res.status(200).json({ success: true, data: v });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "FORBIDDEN_ORG" || code === "ORG_REQUIRED") {
      return res.status(code === "ORG_REQUIRED" ? 400 : 403).json({
        success: false,
        message: (e as Error).message,
        code,
      });
    }
    console.error("lookupVariantByBarcode error:", e);
    return res.status(500).json({ success: false, message: (e as Error).message });
  }
};

/** GET /api/v1/inventory/vendor-receipts/:id/print/grn — HTML GRN print (alias of GET /api/v1/grn/:id/print). */
exports.printVendorReceiptGrnHtml = async (req: any, res: any) => {
  try {
    const userId = req.user?.id ?? req.user?.userId;
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await grnService.getOrgIdsForUser(uid);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const grnRow = await prisma.grn.findFirst({ where: { id, orgId: { in: orgIds } }, select: { orgId: true } });
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });
    const { renderGrnPrintHtml } = require("./printDocuments.service");
    const html = await renderGrnPrintHtml(id, grnRow.orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    console.error("printVendorReceiptGrnHtml", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to render print" });
  }
};

/** GET /api/v1/inventory/vendor-receipts/:id/print/delivery-note — HTML vendor delivery note for GRN. */
exports.printVendorReceiptDeliveryNoteHtml = async (req: any, res: any) => {
  try {
    const userId = req.user?.id ?? req.user?.userId;
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await grnService.getOrgIdsForUser(uid);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const grnRow = await prisma.grn.findFirst({ where: { id, orgId: { in: orgIds } }, select: { orgId: true } });
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });
    const { renderGrnDeliveryNoteHtml } = require("./printDocuments.service");
    const html = await renderGrnDeliveryNoteHtml(id, grnRow.orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    console.error("printVendorReceiptDeliveryNoteHtml", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to render delivery note" });
  }
};

export {};
