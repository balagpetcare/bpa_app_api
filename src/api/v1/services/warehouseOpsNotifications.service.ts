/**
 * In-app notifications for warehouse receive workflows (extendable to email/push).
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { createNotification } from "./notification.service";

async function getOrgOwnerUserId(orgId: number): Promise<number | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { ownerUserId: true },
  });
  return org?.ownerUserId ?? null;
}

async function getGrnBranchId(grnId: number): Promise<number | null> {
  const grn = await prisma.grn.findUnique({
    where: { id: grnId },
    select: { location: { select: { branch: { select: { id: true } } } } },
  });
  return grn?.location?.branch?.id ?? null;
}

/** Notify branch managers + warehouse managers on this branch (in-app). */
async function notifyBranchWarehouseLeads(params: {
  orgId: number;
  branchId: number;
  title: string;
  message: string;
  actionUrl: string;
  dedupeKey: string;
  meta: Record<string, unknown>;
  senderId: number | null;
  priority?: "P1" | "P2";
}): Promise<void> {
  const members = await prisma.branchMember.findMany({
    where: {
      orgId: params.orgId,
      branchId: params.branchId,
      status: "ACTIVE",
      role: { in: ["BRANCH_MANAGER", "WAREHOUSE_MANAGER"] },
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((m) => m.userId))];
  for (const userId of userIds) {
    try {
      await createNotification({
        userId,
        type: "SYSTEM",
        title: params.title,
        message: params.message,
        priority: params.priority ?? "P1",
        orgId: params.orgId,
        branchId: params.branchId,
        source: "warehouse_ops",
        severity: "warn",
        actionUrl: params.actionUrl,
        dedupeKey: params.dedupeKey,
        meta: params.meta,
        senderId: params.senderId,
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyBranchWarehouseLeads failed for user", userId, (e as Error)?.message);
    }
  }
}

/** Notify org owner + warehouse managers that a vendor GRN is awaiting confirmation. */
export async function notifyVendorReceiveSubmittedForConfirmation(params: {
  orgId: number;
  grnId: number;
  actorUserId: number | null;
}): Promise<void> {
  const branchId = await getGrnBranchId(params.grnId);

  const ownerId = await getOrgOwnerUserId(params.orgId);
  if (ownerId != null) {
    try {
      await createNotification({
        userId: ownerId,
        type: "SYSTEM",
        title: "Vendor receive awaiting confirmation",
        message: `GRN #${params.grnId} was submitted and needs manager confirmation before stock is posted.`,
        priority: "P1",
        orgId: params.orgId,
        source: "warehouse_ops",
        severity: "warn",
        actionUrl: `/owner/inventory/grn/${params.grnId}`,
        dedupeKey: `vendor_receive_submit:${params.grnId}`,
        meta: { kind: "VENDOR_RECEIVE_AWAITING_CONFIRMATION", grnId: params.grnId },
        senderId: params.actorUserId,
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyVendorReceiveSubmittedForConfirmation owner failed", (e as Error)?.message);
    }
  }

  if (branchId != null) {
    let vendorName = "";
    let whName = "";
    let totalQty = 0;
    let poNumber = "";
    try {
      const g = await prisma.grn.findUnique({
        where: { id: params.grnId },
        select: {
          vendor: { select: { name: true } },
          purchaseOrder: { select: { poNumber: true } },
          location: { select: { name: true, branch: { select: { name: true } } } },
          lines: { select: { quantity: true } },
        },
      });
      vendorName = g?.vendor?.name?.trim() || "";
      poNumber = g?.purchaseOrder?.poNumber?.trim() || "";
      whName = g?.location?.name?.trim() || g?.location?.branch?.name?.trim() || "";
      totalQty = (g?.lines ?? []).reduce((s, l) => s + Number(l.quantity ?? 0), 0);
    } catch (_) {
      /* optional enrichment */
    }
    const detailParts = [
      vendorName ? `Vendor: ${vendorName}` : null,
      poNumber ? `PO: ${poNumber}` : null,
      whName ? `Warehouse/location: ${whName}` : null,
      totalQty > 0 ? `Qty: ${totalQty}` : null,
    ].filter(Boolean);
    const body = `GRN #${params.grnId} needs confirmation before stock is posted.${detailParts.length ? ` ${detailParts.join(" · ")}` : ""}`;

    try {
      await notifyBranchWarehouseLeads({
        orgId: params.orgId,
        branchId,
        title: "Vendor receive awaiting confirmation",
        message: body,
        actionUrl: `/staff/branch/${branchId}/warehouse/vendor-receipts/${params.grnId}`,
        dedupeKey: `vendor_receive_submit_mgr:${params.grnId}`,
        meta: {
          kind: "VENDOR_RECEIVE_AWAITING_CONFIRMATION",
          grnId: params.grnId,
          branchId,
          ...(poNumber ? { poNumber } : {}),
        },
        senderId: params.actorUserId,
        priority: "P1",
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyVendorReceiveSubmittedForConfirmation managers failed", (e as Error)?.message);
    }
  }
}

/** Notify org owner + original submitter that a GRN has been confirmed and stock posted. */
export async function notifyGrnConfirmed(params: {
  orgId: number;
  grnId: number;
  actorUserId: number | null;
}): Promise<void> {
  const ownerId = await getOrgOwnerUserId(params.orgId);

  const session = await prisma.vendorReceiveSession.findUnique({
    where: { grnId: params.grnId },
    select: { submittedByUserId: true },
  });
  const submitterId = session?.submittedByUserId ?? null;

  const targets = new Set<number>();
  if (ownerId != null) targets.add(ownerId);
  if (submitterId != null && submitterId !== params.actorUserId) targets.add(submitterId);

  for (const userId of targets) {
    try {
      await createNotification({
        userId,
        type: "SYSTEM",
        title: "GRN confirmed — stock posted",
        message: `GRN #${params.grnId} has been confirmed by the warehouse manager. Stock is now available in inventory.`,
        priority: "P2",
        orgId: params.orgId,
        source: "warehouse_ops",
        severity: "info",
        actionUrl: `/owner/inventory/grn/${params.grnId}`,
        dedupeKey: `vendor_receive_confirmed:${params.grnId}`,
        meta: { kind: "VENDOR_RECEIVE_CONFIRMED", grnId: params.grnId },
        senderId: params.actorUserId,
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyGrnConfirmed failed for user", userId, (e as Error)?.message);
    }
  }
}

/** Notify org owner that a branch dispatch receive is awaiting manager confirmation. */
export async function notifyDispatchReceiveSubmittedForConfirmation(params: {
  orgId: number;
  stockDispatchId: number;
  actorUserId: number | null;
}): Promise<void> {
  const ownerId = await getOrgOwnerUserId(params.orgId);
  if (ownerId == null) return;
  let actionUrl = `/owner/inventory/stock-requests`;
  const meta: Record<string, unknown> = {
    kind: "DISPATCH_RECEIVE_AWAITING_CONFIRMATION",
    stockDispatchId: params.stockDispatchId,
  };
  try {
    const d = await prisma.stockDispatch.findUnique({
      where: { id: params.stockDispatchId },
      select: {
        stockRequestId: true,
        toLocation: { select: { branchId: true } },
      },
    });
    const toBranchId = d?.toLocation?.branchId ?? null;
    if (d?.stockRequestId != null) {
      meta.stockRequestId = d.stockRequestId;
      actionUrl = `/owner/inventory/stock-requests/${d.stockRequestId}`;
    }
    if (toBranchId != null) {
      meta.toBranchId = toBranchId;
    }
  } catch (_) {
    /* optional enrichment */
  }
  try {
    await createNotification({
      userId: ownerId,
      type: "SYSTEM",
      title: "Branch receive awaiting confirmation",
      message: `Dispatch #${params.stockDispatchId} receive was submitted and needs manager confirmation.`,
      priority: "P1",
      orgId: params.orgId,
      source: "warehouse_ops",
      severity: "warn",
      actionUrl,
      dedupeKey: `dispatch_receive_submit:${params.stockDispatchId}`,
      meta,
      senderId: params.actorUserId,
    });
  } catch (e) {
    console.warn("[warehouseOpsNotifications] notifyDispatchReceiveSubmittedForConfirmation failed", (e as Error)?.message);
  }
}

async function resolveStaffBranchIdForWarehouse(warehouseId: number): Promise<number | null> {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: {
      branchId: true,
      locations: { take: 1, select: { branchId: true } },
    },
  });
  return wh?.branchId ?? wh?.locations?.[0]?.branchId ?? null;
}

/** Notify active warehouse staff that a submitted stock request may need DC fulfillment (enterprise queue). */
export async function notifyWarehouseStaffStockRequestSubmitted(params: {
  orgId: number;
  stockRequestId: number;
}): Promise<void> {
  const assignments = await prisma.warehouseStaffAssignment.findMany({
    where: { isActive: true, warehouse: { orgId: params.orgId, isActive: true } },
    select: {
      userId: true,
      warehouseId: true,
    },
  });
  const notified = new Set<string>();
  for (const a of assignments) {
    const branchId = await resolveStaffBranchIdForWarehouse(a.warehouseId);
    if (branchId == null) continue;
    const key = `${a.userId}:${params.stockRequestId}`;
    if (notified.has(key)) continue;
    notified.add(key);
    try {
      await createNotification({
        userId: a.userId,
        type: "INVENTORY_STOCK_REQUEST",
        title: "Stock request in warehouse queue",
        message: `Request #${params.stockRequestId} needs fulfillment review.`,
        priority: "P2",
        orgId: params.orgId,
        branchId,
        source: "warehouse_ops",
        severity: "info",
        actionUrl: `/staff/branch/${branchId}/warehouse/requests/${params.stockRequestId}`,
        dedupeKey: `warehouse_sr_queue:${params.stockRequestId}:${a.userId}`,
        meta: { kind: "WAREHOUSE_STOCK_REQUEST_QUEUE", stockRequestId: params.stockRequestId, warehouseId: a.warehouseId },
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyWarehouseStaffStockRequestSubmitted", (e as Error)?.message);
    }
  }
}

/** Notify warehouse staff that a pick list is ready (after allocation / wave generation). */
export async function notifyWarehouseStaffPickListCreated(params: {
  orgId: number;
  pickListId: number;
  allocationPlanId: number;
}): Promise<void> {
  const pl = await prisma.pickList.findUnique({
    where: { id: params.pickListId },
    select: {
      orgId: true,
      fromLocationId: true,
      fromLocation: { select: { warehouseId: true } },
    },
  });
  if (!pl?.fromLocation?.warehouseId) return;
  const branchId = await resolveStaffBranchIdForWarehouse(pl.fromLocation.warehouseId);
  if (branchId == null) return;

  const assignments = await prisma.warehouseStaffAssignment.findMany({
    where: {
      isActive: true,
      warehouseId: pl.fromLocation.warehouseId,
    },
    select: { userId: true },
  });
  const users = [...new Set(assignments.map((a) => a.userId))];
  for (const userId of users) {
    try {
      await createNotification({
        userId,
        type: "SYSTEM",
        title: "Pick list ready",
        message: `Pick list #${params.pickListId} is ready for the allocation plan.`,
        priority: "P2",
        orgId: params.orgId,
        branchId,
        source: "warehouse_ops",
        severity: "info",
        actionUrl: `/staff/branch/${branchId}/warehouse/pick-lists/${params.pickListId}`,
        dedupeKey: `warehouse_pick_ready:${params.pickListId}:${userId}`,
        meta: {
          kind: "WAREHOUSE_PICK_LIST_READY",
          pickListId: params.pickListId,
          allocationPlanId: params.allocationPlanId,
        },
      });
    } catch (e) {
      console.warn("[warehouseOpsNotifications] notifyWarehouseStaffPickListCreated", (e as Error)?.message);
    }
  }
}
