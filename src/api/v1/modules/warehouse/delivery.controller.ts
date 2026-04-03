export {};
const service = require("./delivery.service");
const db = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Verify user is org owner/admin or warehouse manager for the dispatch's org */
async function requireDispatchAccess(userId: number, dispatchId: number): Promise<boolean> {
  const dispatch = await db.stockDispatch.findUnique({
    where: { id: dispatchId },
    select: { orgId: true },
  });
  if (!dispatch) return false;

  const org = await db.organization.findUnique({
    where: { id: dispatch.orgId },
    select: { ownerUserId: true },
  });
  if (org?.ownerUserId === userId) return true;

  const member = await db.orgMember.findFirst({
    where: { orgId: dispatch.orgId, userId, status: "ACTIVE", role: { in: ["OWNER", "ORG_ADMIN"] } },
  });
  if (member) return true;

  const orgWarehouseIds = await db.warehouse.findMany({
    where: { orgId: dispatch.orgId, isActive: true },
    select: { id: true },
  });
  const whIds = orgWarehouseIds.map((w: { id: number }) => w.id);
  if (!whIds.length) return false;

  const whAssignment = await db.warehouseStaffAssignment.findFirst({
    where: {
      userId,
      isActive: true,
      warehouseId: { in: whIds },
      role: { in: ["WAREHOUSE_MANAGER", "DISPATCH_STAFF", "INVENTORY_CONTROLLER"] },
    },
  });
  return !!whAssignment;
}

/**
 * POST /warehouse/dispatches/:dispatchId/assign-delivery
 * Body: { assignedToUserId, note? }
 */
async function assignDelivery(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const dispatchId = Number(req.params.dispatchId);
    if (!dispatchId) return res.status(400).json({ success: false, message: "Invalid dispatch id" });

    const canAccess = await requireDispatchAccess(userId, dispatchId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const { assignedToUserId, note } = req.body;
    if (!assignedToUserId) {
      return res.status(400).json({ success: false, message: "assignedToUserId is required" });
    }

    const assignment = await service.assignDelivery({
      dispatchId,
      assignedToUserId: Number(assignedToUserId),
      assignedByUserId: userId,
      note,
    });

    return res.status(201).json({ success: true, data: assignment });
  } catch (e: any) {
    console.error("delivery.assignDelivery", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to assign delivery" });
  }
}

/**
 * GET /warehouse/delivery/assignments — My delivery assignments
 * Query: status? (comma-separated)
 */
async function myAssignments(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const status = req.query.status as string | undefined;
    const assignments = await service.listMyAssignments(userId, { status });

    return res.status(200).json({ success: true, data: assignments });
  } catch (e: any) {
    console.error("delivery.myAssignments", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list assignments" });
  }
}

/**
 * GET /warehouse/delivery/assignments/:id
 */
async function getAssignment(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const assignment = await service.getAssignmentById(id);
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });

    if (assignment.assignedToUserId !== userId) {
      const canAccess = await requireDispatchAccess(userId, assignment.dispatchId);
      if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    }

    return res.status(200).json({ success: true, data: assignment });
  } catch (e: any) {
    console.error("delivery.getAssignment", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get assignment" });
  }
}

/**
 * POST /warehouse/delivery/:id/start
 */
async function startDelivery(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const assignment = await db.deliveryAssignment.findUnique({
      where: { id },
      select: { assignedToUserId: true },
    });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    if (assignment.assignedToUserId !== userId) {
      return res.status(403).json({ success: false, message: "Only the assigned delivery staff can start" });
    }

    const result = await service.startDelivery(id);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("delivery.startDelivery", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to start delivery" });
  }
}

/**
 * POST /warehouse/delivery/:id/arrive
 */
async function markArrived(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const assignment = await db.deliveryAssignment.findUnique({
      where: { id },
      select: { assignedToUserId: true },
    });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    if (assignment.assignedToUserId !== userId) {
      return res.status(403).json({ success: false, message: "Only the assigned delivery staff can mark arrived" });
    }

    const result = await service.markArrived(id);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("delivery.markArrived", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to mark arrived" });
  }
}

/**
 * POST /warehouse/delivery/:id/complete
 * Body: { receivedByName?, podNote?, gpsLat?, gpsLng? }
 */
async function completeDelivery(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const assignment = await db.deliveryAssignment.findUnique({
      where: { id },
      select: { assignedToUserId: true },
    });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
    if (assignment.assignedToUserId !== userId) {
      return res.status(403).json({ success: false, message: "Only the assigned delivery staff can complete" });
    }

    const { receivedByName, recipientPhone, podNote, gpsLat, gpsLng, signatureFileKey, photoFileKey } = req.body || {};
    const result = await service.completeDelivery(id, {
      receivedByName,
      recipientPhone,
      podNote,
      gpsLat: gpsLat != null && gpsLat !== "" ? Number(gpsLat) : undefined,
      gpsLng: gpsLng != null && gpsLng !== "" ? Number(gpsLng) : undefined,
      signatureFileKey,
      photoFileKey,
      recordedByUserId: userId,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("delivery.completeDelivery", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to complete delivery" });
  }
}

/**
 * POST /warehouse/delivery/:id/fail
 * Body: { reason }
 */
async function failDelivery(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const assignment = await db.deliveryAssignment.findUnique({
      where: { id },
      select: { assignedToUserId: true, dispatchId: true },
    });
    if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });

    if (assignment.assignedToUserId !== userId) {
      const canAccess = await requireDispatchAccess(userId, assignment.dispatchId);
      if (!canAccess) {
        return res.status(403).json({ success: false, message: "Not authorized" });
      }
    }

    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ success: false, message: "reason is required" });

    const result = await service.failDelivery(id, reason);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("delivery.failDelivery", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to fail delivery" });
  }
}

module.exports = {
  assignDelivery,
  myAssignments,
  getAssignment,
  startDelivery,
  markArrived,
  completeDelivery,
  failDelivery,
};
