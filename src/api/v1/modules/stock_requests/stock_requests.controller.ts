export {};
const service = require("./stock_requests.service");
const { getManagedBranchesForUser } = require("../../services/branchManager.service");
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
    const { branchId, items } = req.body;
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
    const managed = await getManagedBranchesForUser(userId);
    const canAccess = managed.some((b: any) => b.branchId === branch.id);
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (!canAccess && ownedOrg?.id !== branch.orgId) {
      return res.status(403).json({ success: false, message: "Not authorized to create request for this branch" });
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
      const managed = await getManagedBranchesForUser(userId);
      branchIds = managed.map((b: any) => b.branchId);
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
    const fromLocationId = req.query.fromLocationId ? Number(req.query.fromLocationId) : undefined;
    const request = await service.getRequestById(id, { fromLocationId });
    if (!request) {
      return res.status(404).json({ success: false, message: "Stock request not found" });
    }
    const managed = await getManagedBranchesForUser(userId);
    const branchIds = managed.map((b: any) => b.branchId);
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
    const managed = await getManagedBranchesForUser(userId);
    const canAccess = managed.some((b: any) => b.branchId === existing.branchId);
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (!canAccess && ownedOrg?.id !== existing.orgId) {
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
    const managed = await getManagedBranchesForUser(userId);
    const canAccess = managed.some((b: any) => b.branchId === existing.branchId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
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
    const managed = await getManagedBranchesForUser(userId);
    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const canAccess =
      managed.some((b: any) => b.branchId === existing.branchId) ||
      ownedOrg?.id === existing.orgId;
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    const request = await service.cancelRequest(id);
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("stock_requests.cancel", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to cancel" });
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
        lotId: Number(i.lotId),
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

module.exports = {
  create,
  list,
  getById,
  updateItems,
  submit,
  cancel,
  approve,
  decline,
  dispatch,
};
