export {};
const service = require("./stock_requests.service");
const {
  userCanAccessStockRequestBranch,
  getStockRequestListBranchIdsForUser,
} = require("./stockRequestAccess");
const { createNotification } = require("../../services/notification.service");
const db = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * POST /api/v1/stock-requests — Create draft (branch). Body: branchId, items[{ productId, variantId, requestedQty, note? }]
 */
async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { branchId, items, orgId: bodyOrgId, requesterStaffId: _requesterStaffId } = req.body;
    if (!branchId || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "branchId and items (array) are required",
      });
    }
    const branch = await db.branch.findUnique({
      where: { id: Number(branchId) },
      select: { id: true, orgId: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }
    if (bodyOrgId != null && String(bodyOrgId).trim() !== "") {
      const n = Number(bodyOrgId);
      if (Number.isFinite(n) && n > 0 && n !== branch.orgId) {
        return res.status(400).json({
          success: false,
          message: "orgId does not match this branch's organization",
        });
      }
    }
    const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const gate = await userCanAccessStockRequestBranch(userId, branch.id, perms);
    if (!gate.ok) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create request for this branch",
        code: "STOCK_REQUEST_BRANCH_FORBIDDEN",
      });
    }
    const request = await service.createRequest({
      orgId: branch.orgId,
      branchId: branch.id,
      requesterUserId: userId,
      items: items.map((i: any) => ({
        productId: Number(i.productId),
        variantId: Number(i.variantId),
        requestedQty: Number(i.requestedQty),
        note: i.note,
      })),
    });
    return res.status(201).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create request" });
  }
}

/**
 * GET /api/v1/stock-requests — List. Query: branchId (single), orgId (owner), status, dateFrom, dateTo, page, limit.
 * Branch users: filter by their managed branches. Owner: filter by orgId (their orgs).
 */
async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const status = req.query.status as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    let branchIds: number[] | undefined;
    let filterOrgId: number | undefined;
    if (orgId) {
      const org = await db.organization.findFirst({
        where: { id: orgId, ownerUserId: userId },
        select: { id: true },
      });
      if (org) filterOrgId = org.id;
    }
    if (!filterOrgId) {
      branchIds = await getStockRequestListBranchIdsForUser(userId);
      if (branchId && branchIds.includes(branchId)) {
        branchIds = [branchId];
      } else if (branchId) {
        branchIds = [];
      }
    }
    const result = await service.listRequests({
      branchIds: filterOrgId ? undefined : branchIds,
      orgId: filterOrgId,
      status,
      dateFrom,
      dateTo,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("stock_requests.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list requests" });
  }
}

/**
 * GET /api/v1/stock-requests/:id — Detail. Query: fromLocationId (for owner, include available lots).
 */
async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    let fromLocationId: number | undefined;
    if (req.query.fromLocationId != null && String(req.query.fromLocationId).trim() !== "") {
      const n = Number(req.query.fromLocationId);
      fromLocationId = Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const request = await service.getRequestById(id, { fromLocationId });
    if (!request) {
      return res.status(404).json({ success: false, message: "Stock request not found" });
    }
    const branchIds = await getStockRequestListBranchIdsForUser(userId);
    const ownedOrgs = await db.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const orgIds = ownedOrgs.map((o: any) => o.id);
    const canAccess =
      branchIds.includes((request as any).branchId) ||
      orgIds.includes((request as any).orgId);
    if (!canAccess) {
      return res.status(403).json({ success: false, message: "Not authorized to view this request" });
    }
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get request" });
  }
}

/**
 * PATCH /api/v1/stock-requests/:id — Update items (draft only). Body: items[{ productId, variantId, requestedQty, note? }]
 */
async function updateItems(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const { items } = req.body;
    if (!items?.length) {
      return res.status(400).json({ success: false, message: "items array is required" });
    }
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const gate = await userCanAccessStockRequestBranch(userId, existing.branchId, perms);
    if (!gate.ok && ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Not authorized to update this request" });
    }
    const request = await service.updateRequestItems(
      id,
      items.map((i: any) => ({
        productId: Number(i.productId),
        variantId: Number(i.variantId),
        requestedQty: Number(i.requestedQty),
        note: i.note,
      }))
    );
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.updateItems", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/submit — Submit draft.
 */
async function submit(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const perms = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
    const gate = await userCanAccessStockRequestBranch(userId, existing.branchId, perms);
    if (!gate.ok) return res.status(403).json({ success: false, message: "Not authorized" });
    const request = await service.submitRequest(id);
    try {
      const org = await db.organization.findUnique({
        where: { id: existing.orgId },
        select: { ownerUserId: true },
      });
      if (org?.ownerUserId) {
        const branch = await db.branch.findUnique({
          where: { id: existing.branchId },
          select: { name: true },
        });
        await createNotification({
          userId: org.ownerUserId,
          type: "INVENTORY_STOCK_REQUEST",
          title: "New stock request",
          message: `Stock request #${id} has been submitted and needs your review.`,
          actionUrl: `/owner/inventory/stock-requests/${id}`,
          dedupeKey: `stock-request:${id}`,
          branchId: existing.branchId,
          source: "inventory",
          meta: {
            stockRequestId: id,
            branchId: existing.branchId,
            branchName: branch?.name ?? `Branch #${existing.branchId}`,
          },
        });
      }
    } catch (notifErr: any) {
      console.warn("stock_requests.submit notification", notifErr?.message);
    }
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.submit", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to submit" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/cancel — Cancel draft or submitted.
 */
async function cancel(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const listBranchIds = await getStockRequestListBranchIdsForUser(userId);
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const canAccess = listBranchIds.includes(existing.branchId) || ownedOrg?.id === existing.orgId;
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    const request = await service.cancelRequest(id);
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.cancel", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to cancel" });
  }
}

/**
 * PATCH /api/v1/stock-requests/:id/fulfill — Owner: flexible fulfillment (partial/over, extras, optional lots).
 * Body: fromLocationId, toLocationId, manualMode?, items?, extraItems?
 */
async function fulfill(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const { fromLocationId, toLocationId, manualMode, items, extraItems } = req.body || {};
    if (!fromLocationId || !toLocationId) {
      return res.status(400).json({
        success: false,
        message: "fromLocationId and toLocationId are required",
      });
    }
    const hasItems = Array.isArray(items) && items.length > 0;
    const hasExtras = Array.isArray(extraItems) && extraItems.length > 0;
    if (!hasItems && !hasExtras) {
      return res.status(400).json({
        success: false,
        message: "items and/or extraItems (non-empty) are required",
      });
    }
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can fulfill" });
    }
    const result = await service.fulfillStockRequestFlexible(id, {
      fromLocationId: Number(fromLocationId),
      toLocationId: Number(toLocationId),
      manualMode: Boolean(manualMode),
      items: hasItems
        ? items.map((i: any) => ({
            stockRequestItemId: i.stockRequestItemId != null ? Number(i.stockRequestItemId) : undefined,
            variantId: i.variantId != null ? Number(i.variantId) : undefined,
            fulfillQty: Number(i.fulfillQty),
            lots: Array.isArray(i.lots)
              ? i.lots.map((l: any) => ({
                  lotId: Number(l.lotId),
                  quantity: Number(l.quantity),
                }))
              : undefined,
          }))
        : undefined,
      extraItems: hasExtras
        ? extraItems.map((i: any) => ({
            productId: Number(i.productId),
            variantId: Number(i.variantId),
            fulfillQty: Number(i.fulfillQty),
            lots: Array.isArray(i.lots)
              ? i.lots.map((l: any) => ({
                  lotId: Number(l.lotId),
                  quantity: Number(l.quantity),
                }))
              : undefined,
          }))
        : undefined,
      createdByUserId: userId,
    });
    const refreshed = await service.getRequestById(id, { fromLocationId: Number(fromLocationId) });
    const fulfillment = result.fulfillment as { dispatched?: boolean; message?: string };
    if (!fulfillment?.dispatched) {
      return res.status(422).json({
        success: false,
        data: {
          transfer: null,
          fulfillment: result.fulfillment,
          request: refreshed,
        },
        message: fulfillment?.message || "No quantity could be dispatched",
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        transfer: result.transfer,
        fulfillment: result.fulfillment,
        request: refreshed,
      },
      message: fulfillment?.message || "Dispatched",
    });
  } catch (e: any) {
    console.error("stock_requests.fulfill", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to fulfill" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/dispatch — Owner: fulfill and dispatch. Body: fromLocationId, toLocationId, items[{ variantId, lotId, quantity }]
 */
async function dispatch(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const { fromLocationId, toLocationId, items } = req.body;
    if (!fromLocationId || !toLocationId || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "fromLocationId, toLocationId, and items (array) are required",
      });
    }
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can dispatch" });
    }
    const transfer = await service.fulfillAndDispatch(id, {
      fromLocationId: Number(fromLocationId),
      toLocationId: Number(toLocationId),
      items: items.map((i: any) => ({
        variantId: Number(i.variantId),
        lotId: i.lotId == null || i.lotId === "" ? null : Number(i.lotId),
        quantity: Number(i.quantity),
      })),
      createdByUserId: userId,
    });
    return res.status(200).json({ success: true, data: transfer, message: "Dispatched" });
  } catch (e: any) {
    console.error("stock_requests.dispatch", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to dispatch" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/approve — Owner: approve with partial qty + optional extra items.
 * Body: approvedItems[{ variantId, approvedQty }], extraItems?[{ variantId, quantity }]
 */
async function approve(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const { approvedItems, extraItems } = req.body || {};
    if (!approvedItems?.length && !(extraItems?.length)) {
      return res.status(400).json({
        success: false,
        message: "approvedItems (array) or extraItems (array) is required",
      });
    }
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can approve" });
    }
    const request = await service.approveRequest(id, {
      approvedItems: (approvedItems || []).map((i: any) => ({
        variantId: Number(i.variantId),
        approvedQty: Number(i.approvedQty),
      })),
      extraItems: (extraItems || []).map((i: any) => ({
        variantId: Number(i.variantId),
        quantity: Number(i.quantity),
      })),
      approvedByUserId: userId,
    });
    return res.status(200).json({ success: true, data: request, message: "Approved" });
  } catch (e: any) {
    console.error("stock_requests.approve", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to approve" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/decline — Owner: decline with reason/source.
 */
async function decline(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const { reason, source } = req.body || {};
    const existing = await db.stockRequest.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can decline" });
    }
    const request = await service.declineRequest(id, {
      reason: reason ? String(reason) : undefined,
      source: source ? String(source) : undefined,
      declinedByUserId: userId,
    });
    return res.status(200).json({ success: true, data: request, message: "Declined" });
  } catch (e: any) {
    console.error("stock_requests.decline", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to decline" });
  }
}

/**
 * PATCH /api/v1/stock-requests/:id/items/:itemId/cancel — Owner: cancel specific line (full or partial qty).
 * Body: { cancelledQty, reason? }
 */
async function cancelLineHandler(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const requestId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!requestId || !itemId) {
      return res.status(400).json({ success: false, message: "Invalid id or itemId" });
    }

    const { cancelledQty, reason } = req.body || {};
    if (!cancelledQty || cancelledQty < 0) {
      return res.status(400).json({ success: false, message: "cancelledQty is required and must be >= 0" });
    }

    // Check owner authorization
    const existing = await db.stockRequest.findUnique({
      where: { id: requestId },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can cancel lines" });
    }

    const item = await service.cancelLine(requestId, itemId, {
      cancelledQty: Number(cancelledQty),
      reason: reason ? String(reason) : undefined,
      cancelledByUserId: userId,
    });

    return res.status(200).json({ success: true, data: item, message: "Line cancelled" });
  } catch (e: any) {
    console.error("stock_requests.cancelLine", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to cancel line" });
  }
}

/**
 * PATCH /api/v1/stock-requests/:id/items/:itemId/restore — Owner: restore cancelled line (sets cancelledQty = 0).
 */
async function restoreLineHandler(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const requestId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!requestId || !itemId) {
      return res.status(400).json({ success: false, message: "Invalid id or itemId" });
    }

    // Check owner authorization
    const existing = await db.stockRequest.findUnique({
      where: { id: requestId },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can restore lines" });
    }

    const item = await service.restoreLine(requestId, itemId);

    return res.status(200).json({ success: true, data: item, message: "Line restored" });
  } catch (e: any) {
    console.error("stock_requests.restoreLine", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to restore line" });
  }
}

/**
 * POST /api/v1/stock-requests/:id/allocation-preview — Owner: preview FEFO allocation without executing dispatch.
 * Body: { fromLocationId, items: [{ stockRequestItemId, fulfillQty }] }
 */
async function allocationPreviewHandler(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const requestId = Number(req.params.id);
    if (!requestId) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const { fromLocationId, items } = req.body || {};
    if (!fromLocationId || !items?.length) {
      return res.status(400).json({ success: false, message: "fromLocationId and items are required" });
    }

    // Check owner authorization
    const existing = await db.stockRequest.findUnique({
      where: { id: requestId },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Stock request not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can preview allocation" });
    }

    const result = await service.allocationPreview(requestId, {
      fromLocationId: Number(fromLocationId),
      items: items.map((i: any) => ({
        stockRequestItemId: Number(i.stockRequestItemId),
        fulfillQty: Number(i.fulfillQty),
      })),
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("stock_requests.allocationPreview", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to preview allocation" });
  }
}

module.exports = {
  create,
  list,
  getById,
  updateItems,
  submit,
  cancel,
  approve,
  decline,
  fulfill,
  dispatch,
  cancelLineHandler,
  restoreLineHandler,
  allocationPreviewHandler,
};
