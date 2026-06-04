/**
 * Notifications for dispatch events (e.g. after receive, on create).
 * Uses existing NotificationType.INVENTORY_TRANSFER; no schema change.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { createNotification } from "../../services/notification.service";

export type NotifyDispatchCreatedParams = {
  dispatchId: number;
  dispatch: {
    orgId: number;
    fromLocation?: { name?: string | null } | null;
    toLocation?: { name?: string | null } | null;
    items?: Array<{ variantId?: number; quantityDispatched?: number }>;
  };
  toBranchId: number | null;
};

export async function notifyDispatchCreated(params: NotifyDispatchCreatedParams): Promise<void> {
  const { dispatchId, dispatch, toBranchId } = params;
  if (!toBranchId) return;
  const fromName = dispatch.fromLocation?.name ?? "Unknown";
  const toName = dispatch.toLocation?.name ?? "Unknown";
  const items = dispatch.items ?? [];
  const lineCount = items.length;
  const totalQty = items.reduce((s, i) => s + (i.quantityDispatched ?? 0), 0);
  const message = `Dispatch #${dispatchId} created: ${fromName} → ${toName} (${lineCount} line(s), Qty ${totalQty}). Awaiting branch receive confirmation.`;
  const actionUrl = `/staff/branch/${toBranchId}/warehouse/inbound-transfers`;
  const members = await prisma.branchMember.findMany({
    where: { branchId: toBranchId, status: "ACTIVE" },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((m) => m.userId))];
  for (const userId of userIds) {
    try {
      await createNotification({
        userId,
        type: "INVENTORY_TRANSFER",
        title: "Incoming dispatch",
        message,
        actionUrl,
        source: "dispatches",
        orgId: dispatch.orgId,
        branchId: toBranchId,
        dedupeKey: `dispatch-created-${dispatchId}-${userId}`,
        panel: "staff",
      });
    } catch (e) {
      console.warn("[notifyDispatchCreated] createNotification failed for user", userId, (e as Error)?.message);
    }
  }
}

export type NotifyDispatchReceivedParams = {
  dispatchId: number;
  /** Dispatch with fromLocation, toLocation, orgId, createdByUserId */
  dispatch: {
    orgId: number;
    createdByUserId?: number | null;
    fromLocation?: { name?: string | null } | null;
    toLocation?: { name?: string | null } | null;
  };
  /** Result from receiveDispatch (grn with lines) */
  result: {
    grn?: {
      lines?: Array<{ quantity?: number | null }>;
    } | null;
  };
  receiverUserId: number;
  /** Must be derived only from dispatch destination (toLocation.branchId or DB by toLocationId). Never from request. */
  toBranchId: number | null;
};

/**
 * After successful receive: notify receiver, sender (if createdByUserId), and org owner.
 * actionUrl points at the branch inbound queue when toBranchId is set (consistent with unified inbound UX).
 * Dedupes recipients. Does not change API response.
 */
export async function notifyDispatchReceived(params: NotifyDispatchReceivedParams): Promise<void> {
  const { dispatchId, dispatch, result, receiverUserId, toBranchId } = params;
  const fromName = dispatch.fromLocation?.name ?? "Unknown";
  const toName = dispatch.toLocation?.name ?? "Unknown";
  const lines = result.grn?.lines ?? [];
  const lineCount = lines.length;
  const totalQty = lines.reduce((sum, l) => sum + (l.quantity ?? 0), 0);
  const message = `Dispatch #${dispatchId} received from ${fromName} to ${toName} (${lineCount} lines, Qty ${totalQty}).`;
  const actionUrl =
    toBranchId != null
      ? `/staff/branch/${toBranchId}/warehouse/inbound-transfers`
      : undefined;

  const recipientIds: number[] = [receiverUserId];
  if (dispatch.createdByUserId != null) recipientIds.push(dispatch.createdByUserId);
  const org = await prisma.organization.findUnique({
    where: { id: dispatch.orgId },
    select: { ownerUserId: true },
  });
  if (org?.ownerUserId != null) recipientIds.push(org.ownerUserId);
  const userIds = [...new Set(recipientIds)];

  const payload = {
    type: "INVENTORY_TRANSFER" as const,
    title: "Stock received",
    message,
    actionUrl: actionUrl ?? null,
    source: "dispatches",
    orgId: dispatch.orgId,
    branchId: toBranchId,
  };

  for (const userId of userIds) {
    try {
      await createNotification({
        ...payload,
        userId,
        dedupeKey: `dispatch-receive-${dispatchId}-${userId}`,
      });
    } catch (e) {
      console.warn("[notifyDispatchReceived] createNotification failed for user", userId, (e as Error)?.message);
    }
  }
}
