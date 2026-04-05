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
      actionUrl: `/owner/inventory/stock-requests`,
      dedupeKey: `dispatch_receive_submit:${params.stockDispatchId}`,
      meta: { kind: "DISPATCH_RECEIVE_AWAITING_CONFIRMATION", stockDispatchId: params.stockDispatchId },
      senderId: params.actorUserId,
    });
  } catch (e) {
    console.warn("[warehouseOpsNotifications] notifyDispatchReceiveSubmittedForConfirmation failed", (e as Error)?.message);
  }
}
