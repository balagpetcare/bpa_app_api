export {};
const service = require("./medicine_requisitions.service");
const { createNotification } = require("../../services/notification.service");
const db = require("../../../../infrastructure/db/prismaClient").default;
const {
  resolveMedicineRequisitionListScope,
  canReadMedicineRequisition,
  canCreateMedicineRequisitionOnBranch,
  canActAsBranchStaffOnMedicineRequisition,
  canModifyMedicineRequisitionItemsOrCancel,
  canSearchMedicineAtBranch,
} = require("./medicine_requisitions.scope");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * POST /api/v1/medicine-requisitions — Create draft requisition (branch).
 * Body: branchId, urgency?, note?, items[{ medicineListingId, requestedQty, unit?, note?, allowSubstitute? }]
 */
async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { branchId, urgency, note, items } = req.body;
    if (!branchId || !items?.length) {
      return res.status(400).json({ success: false, message: "branchId and items (array) are required" });
    }

    const branch = await db.branch.findUnique({
      where: { id: Number(branchId) },
      select: { id: true, orgId: true },
    });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });

    const canAccess = await canCreateMedicineRequisitionOnBranch(userId, branch);
    if (!canAccess) {
      return res.status(403).json({ success: false, message: "Not authorized for this branch" });
    }

    const requisition = await service.createRequisition({
      orgId: branch.orgId,
      branchId: branch.id,
      requestedByUserId: userId,
      urgency,
      note,
      items: items.map((i: any) => ({
        medicineListingId: Number(i.medicineListingId),
        requestedQty: Number(i.requestedQty),
        unit: i.unit,
        note: i.note,
        allowSubstitute: !!i.allowSubstitute,
      })),
    });

    return res.status(201).json({ success: true, data: requisition });
  } catch (e: any) {
    console.error("medicine_requisitions.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create requisition" });
  }
}

/**
 * GET /api/v1/medicine-requisitions — List requisitions.
 * Query: branchId, orgId, status (single or comma-separated), urgency, dateFrom, dateTo, page, limit
 */
async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const status = req.query.status as string | undefined;
    const urgency = req.query.urgency as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    if (dateFrom && dateTo) {
      const d1 = new Date(`${String(dateFrom).trim()}T00:00:00.000Z`);
      const d2 = new Date(`${String(dateTo).trim()}T23:59:59.999Z`);
      if (d1 > d2) {
        return res.status(400).json({
          success: false,
          message: "dateFrom must be on or before dateTo",
        });
      }
    }

    const scope = await resolveMedicineRequisitionListScope(userId, {
      orgId: orgId && Number.isFinite(orgId) ? orgId : undefined,
      branchId: branchId && Number.isFinite(branchId) ? branchId : undefined,
    });

    if (scope.empty) {
      if (scope.invalidOrg) {
        console.warn("medicine_requisitions.list orgId not in scope", { userId, orgId });
      }
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const result = await service.listRequisitions({
      branchIds: scope.branchIds,
      status,
      urgency,
      dateFrom,
      dateTo,
      page,
      limit,
    });

    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("medicine_requisitions.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list requisitions" });
  }
}

/**
 * GET /api/v1/medicine-requisitions/summary — Dashboard counts (same scope as list, no row filters).
 * Query: orgId?, branchId? — same scoping as list
 */
async function summary(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;

    const scope = await resolveMedicineRequisitionListScope(userId, {
      orgId: orgId && Number.isFinite(orgId) ? orgId : undefined,
      branchId: branchId && Number.isFinite(branchId) ? branchId : undefined,
    });

    if (scope.empty) {
      return res.status(200).json({
        success: true,
        data: { total: 0, pending: 0, approved: 0, dispatched: 0 },
      });
    }

    const data = await service.getRequisitionDashboardSummary(scope.branchIds);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("medicine_requisitions.summary", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load summary" });
  }
}

/**
 * GET /api/v1/medicine-requisitions/:id — Get detail.
 */
async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const requisition = await service.getRequisitionById(id);
    if (!requisition) return res.status(404).json({ success: false, message: "Requisition not found" });

    const canAccess = await canReadMedicineRequisition(userId, {
      branchId: requisition.branchId,
      orgId: requisition.orgId,
    });
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    return res.status(200).json({ success: true, data: requisition });
  } catch (e: any) {
    console.error("medicine_requisitions.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get requisition" });
  }
}

/**
 * PATCH /api/v1/medicine-requisitions/:id — Update items (DRAFT only).
 * Body: items[{ medicineListingId, requestedQty, unit?, note?, allowSubstitute? }]
 */
async function updateItems(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const { items } = req.body;
    if (!items?.length) return res.status(400).json({ success: false, message: "items array is required" });

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const canAccess = await canModifyMedicineRequisitionItemsOrCancel(userId, existing);
    if (!canAccess) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const requisition = await service.updateRequisitionItems(
      id,
      items.map((i: any) => ({
        medicineListingId: Number(i.medicineListingId),
        requestedQty: Number(i.requestedQty),
        unit: i.unit,
        note: i.note,
        allowSubstitute: !!i.allowSubstitute,
      })),
      existing.orgId
    );

    return res.status(200).json({ success: true, data: requisition });
  } catch (e: any) {
    console.error("medicine_requisitions.updateItems", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/submit — Submit draft for review.
 */
async function submit(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const canAccess = await canActAsBranchStaffOnMedicineRequisition(userId, existing.branchId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const requisition = await service.submitRequisition(id, userId);

    // Notify org owner
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
          type: "MEDICINE_REQUISITION_SUBMITTED",
          title: "New medicine requisition",
          message: `Medicine requisition #${requisition.requisitionNumber} from ${branch?.name ?? "branch"} needs your review.`,
          actionUrl: `/owner/pharmacy/requisitions/${id}`,
          dedupeKey: `med-req:${id}`,
          branchId: existing.branchId,
          source: "pharmacy",
          meta: { requisitionId: id, branchId: existing.branchId },
        });
      }
    } catch (notifErr: any) {
      console.warn("medicine_requisitions.submit notification", notifErr?.message);
    }

    return res.status(200).json({ success: true, data: requisition });
  } catch (e: any) {
    console.error("medicine_requisitions.submit", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to submit" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/approve — Owner: approve with item-level quantities.
 * Body: reviewNote?, items[{ itemId, approvedQty, substitutedListingId?, substitutionReason? }]
 */
async function approve(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const { items, reviewNote } = req.body || {};
    if (!items?.length) {
      return res.status(400).json({ success: false, message: "items (array) is required" });
    }

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can approve" });
    }

    const requisition = await service.approveRequisition(id, {
      approvedByUserId: userId,
      reviewNote,
      items: items.map((i: any) => ({
        itemId: Number(i.itemId),
        approvedQty: Number(i.approvedQty),
        substitutedListingId: i.substitutedListingId ? Number(i.substitutedListingId) : undefined,
        substitutionReason: i.substitutionReason,
      })),
    });

    // Notify branch requester
    try {
      await createNotification({
        userId: requisition.requestedByUserId,
        type: "MEDICINE_REQUISITION_APPROVED",
        title: "Medicine requisition approved",
        message: `Your medicine requisition #${requisition.requisitionNumber} has been approved.`,
        actionUrl: `/branch/pharmacy/requisitions/${id}`,
        dedupeKey: `med-req-approved:${id}`,
        branchId: requisition.branchId,
        source: "pharmacy",
        meta: { requisitionId: id },
      });
    } catch (notifErr: any) {
      console.warn("medicine_requisitions.approve notification", notifErr?.message);
    }

    return res.status(200).json({ success: true, data: requisition, message: "Approved" });
  } catch (e: any) {
    console.error("medicine_requisitions.approve", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to approve" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/reject — Owner: reject with reason.
 * Body: reason?
 */
async function reject(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const { reason } = req.body || {};
    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { orgId: true, requestedByUserId: true, branchId: true, requisitionNumber: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can reject" });
    }

    const requisition = await service.rejectRequisition(id, userId, reason);

    // Notify branch requester
    try {
      await createNotification({
        userId: existing.requestedByUserId,
        type: "MEDICINE_REQUISITION_REJECTED",
        title: "Medicine requisition rejected",
        message: `Your medicine requisition #${existing.requisitionNumber} has been rejected.${reason ? ` Reason: ${reason}` : ""}`,
        actionUrl: `/branch/pharmacy/requisitions/${id}`,
        dedupeKey: `med-req-rejected:${id}`,
        branchId: existing.branchId,
        source: "pharmacy",
        meta: { requisitionId: id, reason },
      });
    } catch (notifErr: any) {
      console.warn("medicine_requisitions.reject notification", notifErr?.message);
    }

    return res.status(200).json({ success: true, data: requisition, message: "Rejected" });
  } catch (e: any) {
    console.error("medicine_requisitions.reject", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to reject" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/dispatch — Owner: dispatch approved requisition.
 * Body: fromLocationId, toLocationId, items[{ variantId, lotId, quantity }]
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

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can dispatch" });
    }

    const requisition = await service.dispatchRequisition(id, {
      fromLocationId: Number(fromLocationId),
      toLocationId: Number(toLocationId),
      items: items.map((i: any) => ({
        variantId: Number(i.variantId),
        lotId: Number(i.lotId),
        quantity: Number(i.quantity),
      })),
      createdByUserId: userId,
    });

    return res.status(200).json({ success: true, data: requisition, message: "Dispatched" });
  } catch (e: any) {
    console.error("medicine_requisitions.dispatch", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to dispatch" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/dispatch-auto — Owner: dispatch with automatic FEFO batch allocation.
 * Body: fromLocationId, toLocationId (items are auto-allocated using FEFO)
 */
async function dispatchAuto(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const { fromLocationId, toLocationId } = req.body;
    if (!fromLocationId || !toLocationId) {
      return res.status(400).json({
        success: false,
        message: "fromLocationId and toLocationId are required",
      });
    }

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const ownedOrg = await db.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (ownedOrg?.id !== existing.orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can dispatch" });
    }

    const requisition = await service.dispatchRequisitionWithFEFO({
      requisitionId: id,
      fromLocationId: Number(fromLocationId),
      toLocationId: Number(toLocationId),
      userId,
    });

    return res.status(200).json({ success: true, data: requisition, message: "Dispatched with FEFO allocation" });
  } catch (e: any) {
    console.error("medicine_requisitions.dispatchAuto", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to dispatch" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/receive — Branch: receive dispatched goods.
 * Body: items[{ itemId, receivedQty }]
 */
async function receive(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const { items } = req.body;
    if (!items?.length) {
      return res.status(400).json({ success: false, message: "items (array) is required" });
    }

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const canAccess = await canModifyMedicineRequisitionItemsOrCancel(userId, existing);
    if (!canAccess) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const requisition = await service.receiveRequisition(
      id,
      userId,
      items.map((i: any) => ({
        itemId: Number(i.itemId),
        receivedQty: Number(i.receivedQty),
      }))
    );

    return res.status(200).json({ success: true, data: requisition, message: "Received" });
  } catch (e: any) {
    console.error("medicine_requisitions.receive", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to receive" });
  }
}

/**
 * POST /api/v1/medicine-requisitions/:id/cancel — Cancel (DRAFT/SUBMITTED only).
 * Body: reason?
 */
async function cancel(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const existing = await db.medicineRequisition.findUnique({
      where: { id },
      select: { branchId: true, orgId: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: "Requisition not found" });

    const canAccess = await canModifyMedicineRequisitionItemsOrCancel(userId, existing);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const { reason } = req.body || {};
    const requisition = await service.cancelRequisition(id, userId, reason);

    return res.status(200).json({ success: true, data: requisition });
  } catch (e: any) {
    console.error("medicine_requisitions.cancel", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to cancel" });
  }
}

/**
 * GET /api/v1/medicine-requisitions/search-medicine — Search CountryMedicineBrand with joined master data.
 * Query: q, countryId?, limit?
 */
async function searchMedicine(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const q = req.query.q as string | undefined;
    const countryId = req.query.countryId ? Number(req.query.countryId) : undefined;
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    if (branchId) {
      const branch = await db.branch.findUnique({
        where: { id: branchId },
        select: { id: true, orgId: true },
      });
      if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
      const ok = await canSearchMedicineAtBranch(userId, branch);
      if (!ok) {
        return res.status(403).json({ success: false, message: "Not authorized for this branch" });
      }
    }

    const results = await service.searchMedicine({ q, countryId, branchId, limit });
    return res.status(200).json({ success: true, data: results });
  } catch (e: any) {
    console.error("medicine_requisitions.searchMedicine", e);
    return res.status(500).json({ success: false, message: e?.message || "Search failed" });
  }
}

module.exports = {
  create,
  list,
  summary,
  getById,
  updateItems,
  submit,
  approve,
  reject,
  dispatch,
  dispatchAuto,
  receive,
  cancel,
  searchMedicine,
};
