/**
 * Notifications for dispatch events (e.g. after receive).
 * Uses existing NotificationType.INVENTORY_TRANSFER; no schema change.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { createNotification } from "../../services/notification.service";

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
 * actionUrl is always /staff/branch/{toBranchId}/inventory/incoming/{dispatchId} when toBranchId is set.
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
      ? `/staff/branch/${toBranchId}/inventory/incoming/${dispatchId}`
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
