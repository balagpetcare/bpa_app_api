export {};
const db = require("../../../../infrastructure/db/prismaClient").default;
const { logWarehouseAuditInTx } = require("./warehouseAudit.service");
const { userPublicSelect } = require("./userPublicPrismaSelect");

async function assignDelivery(data: {
  dispatchId: number;
  assignedToUserId: number;
  assignedByUserId: number;
  note?: string;
}) {
  const dispatch = await db.stockDispatch.findUnique({
    where: { id: data.dispatchId },
    select: { id: true, status: true },
  });
  if (!dispatch) throw new Error("Dispatch not found");
  if (!["CREATED", "PACKED", "IN_TRANSIT"].includes(dispatch.status)) {
    throw new Error(`Cannot assign delivery for dispatch in status ${dispatch.status}`);
  }

  const existing = await db.deliveryAssignment.findFirst({
    where: {
      dispatchId: data.dispatchId,
      status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED"] },
    },
  });
  if (existing) throw new Error("An active delivery assignment already exists for this dispatch");

  return db.deliveryAssignment.create({
    data: {
      dispatchId: data.dispatchId,
      assignedToUserId: data.assignedToUserId,
      assignedByUserId: data.assignedByUserId,
      note: data.note || null,
    },
    include: {
      assignedTo: { select: userPublicSelect },
      assignedBy: { select: userPublicSelect },
      dispatch: {
        select: { id: true, status: true, fromLocationId: true, toLocationId: true },
      },
    },
  });
}

async function getAssignmentById(id: number) {
  return db.deliveryAssignment.findUnique({
    where: { id },
    include: {
      assignedTo: { select: userPublicSelect },
      assignedBy: { select: userPublicSelect },
      proofOfDelivery: true,
      dispatch: {
        include: {
          proofOfDelivery: true,
          fromLocation: { select: { id: true, name: true, type: true } },
          toLocation: { select: { id: true, name: true, type: true } },
          items: {
            include: {
              variant: { select: { id: true, sku: true, title: true } },
            },
          },
        },
      },
    },
  });
}

async function listMyAssignments(userId: number, opts?: { status?: string }) {
  const where: any = { assignedToUserId: userId };
  if (opts?.status) {
    const statuses = opts.status.split(",").map((s: string) => s.trim().toUpperCase());
    where.status = { in: statuses };
  }

  return db.deliveryAssignment.findMany({
    where,
    include: {
      dispatch: {
        select: {
          id: true,
          status: true,
          fromLocationId: true,
          toLocationId: true,
          fromLocation: { select: { id: true, name: true } },
          toLocation: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });
}

async function startDelivery(id: number) {
  const assignment = await db.deliveryAssignment.findUnique({
    where: { id },
    select: { status: true, dispatchId: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.status !== "ASSIGNED") {
    throw new Error(`Cannot start delivery in status ${assignment.status}`);
  }

  return db.$transaction(async (tx: any) => {
    const updated = await tx.deliveryAssignment.update({
      where: { id },
      data: { status: "EN_ROUTE", startedAt: new Date() },
    });

    await tx.stockDispatch.update({
      where: { id: assignment.dispatchId },
      data: { status: "IN_TRANSIT", inTransitAt: new Date() },
    });

    return updated;
  });
}

async function markArrived(id: number) {
  const assignment = await db.deliveryAssignment.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (assignment.status !== "EN_ROUTE") {
    throw new Error(`Cannot mark arrived in status ${assignment.status}`);
  }

  return db.deliveryAssignment.update({
    where: { id },
    data: { status: "ARRIVED", arrivedAt: new Date() },
  });
}

async function completeDelivery(
  id: number,
  pod: {
    receivedByName?: string;
    podNote?: string;
    recipientPhone?: string;
    gpsLat?: number;
    gpsLng?: number;
    signatureFileKey?: string;
    photoFileKey?: string;
    recordedByUserId?: number;
  }
) {
  const assignment = await db.deliveryAssignment.findUnique({
    where: { id },
    select: { status: true, dispatchId: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (!["EN_ROUTE", "ARRIVED"].includes(assignment.status)) {
    throw new Error(`Cannot complete delivery in status ${assignment.status}`);
  }

  const recipient = (pod.receivedByName || "").trim();
  if (!recipient) {
    throw new Error("Recipient name is required for proof of delivery");
  }

  return db.$transaction(async (tx: any) => {
    const dispatchRow = await tx.stockDispatch.findUnique({
      where: { id: assignment.dispatchId },
      select: { orgId: true },
    });
    if (!dispatchRow) throw new Error("Dispatch not found");

    const dup = await tx.proofOfDelivery.findUnique({
      where: { dispatchId: assignment.dispatchId },
    });
    if (dup) throw new Error("Proof of delivery already recorded for this dispatch");

    await tx.proofOfDelivery.create({
      data: {
        orgId: dispatchRow.orgId,
        dispatchId: assignment.dispatchId,
        deliveryAssignmentId: id,
        recipientName: recipient,
        recipientPhone: (pod.recipientPhone || "").trim() || null,
        note: pod.podNote || null,
        receivedAt: new Date(),
        gpsLat: pod.gpsLat != null ? pod.gpsLat : null,
        gpsLng: pod.gpsLng != null ? pod.gpsLng : null,
        signatureFileKey: pod.signatureFileKey || null,
        photoFileKey: pod.photoFileKey || null,
        recordedByUserId: pod.recordedByUserId ?? null,
      },
    });

    const updated = await tx.deliveryAssignment.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        receivedByName: recipient,
        podNote: pod.podNote || null,
        gpsLat: pod.gpsLat != null ? pod.gpsLat : null,
        gpsLng: pod.gpsLng != null ? pod.gpsLng : null,
      },
    });

    await tx.stockDispatch.update({
      where: { id: assignment.dispatchId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });

    const dispatchMeta = await tx.stockDispatch.findUnique({
      where: { id: assignment.dispatchId },
      select: {
        orgId: true,
        fromLocation: { select: { warehouseId: true } },
      },
    });
    if (dispatchMeta) {
      await logWarehouseAuditInTx(tx, {
        orgId: dispatchMeta.orgId,
        warehouseId: dispatchMeta.fromLocation?.warehouseId ?? null,
        category: "OPERATIONS",
        action: "POD_COMPLETE",
        entityType: "DeliveryAssignment",
        entityId: String(id),
        metadata: { dispatchId: assignment.dispatchId, recipientName: recipient },
        actorUserId: pod.recordedByUserId ?? null,
      });
    }

    return updated;
  });
}

async function failDelivery(id: number, reason: string) {
  const assignment = await db.deliveryAssignment.findUnique({
    where: { id },
    select: { status: true, dispatchId: true },
  });
  if (!assignment) throw new Error("Assignment not found");
  if (!["ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(assignment.status)) {
    throw new Error(`Cannot fail delivery in status ${assignment.status}`);
  }

  return db.$transaction(async (tx: any) => {
    const updated = await tx.deliveryAssignment.update({
      where: { id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        failureReason: reason || "Delivery failed",
      },
    });

    await tx.stockDispatch.update({
      where: { id: assignment.dispatchId },
      data: { status: "FAILED" },
    });

    const dispatchMeta = await tx.stockDispatch.findUnique({
      where: { id: assignment.dispatchId },
      select: {
        orgId: true,
        fromLocation: { select: { warehouseId: true } },
      },
    });
    if (dispatchMeta) {
      await logWarehouseAuditInTx(tx, {
        orgId: dispatchMeta.orgId,
        warehouseId: dispatchMeta.fromLocation?.warehouseId ?? null,
        category: "OPERATIONS",
        action: "POD_FAIL",
        entityType: "DeliveryAssignment",
        entityId: String(id),
        metadata: { dispatchId: assignment.dispatchId, reason: reason || "Delivery failed" },
        actorUserId: null,
      });
    }

    return updated;
  });
}

module.exports = {
  assignDelivery,
  getAssignmentById,
  listMyAssignments,
  startDelivery,
  markArrived,
  completeDelivery,
  failDelivery,
};
