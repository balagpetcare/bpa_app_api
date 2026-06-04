/**
 * Branch inbound receive queue: unified actionable inbound (dispatches + legacy transfers).
 * Rows are filtered to receivable statuses; linked stock requests use canonical receive actionability.
 * Dispatch rows include DispatchReceiveSession (controlled branch receive) when present.
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { getIncomingInboundUnifiedForBranch } from "../modules/inventory/inboundReceipts.service";
import {
  deriveRequestStatus,
  getStatusDisplay,
  isBranchInboundActionable,
  type StockRequestStatus,
} from "./stockRequestStatus.service";

export type BranchInboundDispatchReceiveSession = {
  id: number;
  status: string;
  submittedAt: Date | null;
  confirmedAt: Date | null;
};

export type BranchInboundQueueItem = {
  kind: "DISPATCH" | "TRANSFER";
  inboundId: number;
  status: string;
  fromLocation: { id: number; name: string };
  toLocation: { id: number; name: string; branchId: number };
  quantitiesExpected: number;
  quantitiesReceived: number;
  lineCount: number;
  receiveActionable: boolean;
  linkedStockRequestId: number | null;
  effectiveStatus: string;
  effectiveStatusDisplay: ReturnType<typeof getStatusDisplay>;
  /** Controlled receive session for DISPATCH (DispatchReceiveSession); null for TRANSFER or not created yet. */
  dispatchReceiveSession: BranchInboundDispatchReceiveSession | null;
  /** Single UX hint — backend-derived; UI should not reimplement status rules. */
  nextReceiveAction: string;
  items: Array<{
    variantId: number;
    sku: string | null;
    title: string | null;
    lotId: number | null;
    quantity: number;
    quantityReceived: number;
  }>;
  createdAt: Date;
};

function hasInboundContext(row: { kind: string; status: string }): boolean {
  if (row.kind === "DISPATCH") {
    return row.status === "PACKED" || row.status === "IN_TRANSIT";
  }
  return row.status === "SENT" || row.status === "IN_TRANSIT";
}

function computeNextReceiveAction(params: {
  kind: "DISPATCH" | "TRANSFER";
  dispatchStatus: string;
  session: BranchInboundDispatchReceiveSession | null;
}): string {
  const { kind, dispatchStatus, session } = params;
  if (kind === "TRANSFER") {
    return "OPEN_LEGACY_TRANSFER_RECEIVE";
  }
  if (dispatchStatus === "PACKED") {
    if (session?.status === "DRAFT") return "SAVE_VERIFY_OR_WAIT_IN_TRANSIT";
    if (session?.status === "AWAITING_CONFIRMATION") return "MANAGER_CONFIRM_WHEN_IN_TRANSIT";
    return "SAVE_RECEIVE_DRAFT_OR_AWAIT_IN_TRANSIT";
  }
  if (dispatchStatus === "IN_TRANSIT") {
    const st = session?.status;
    if (!st || st === "CANCELLED") return "START_RECEIVE_DRAFT";
    if (st === "DRAFT") return "SUBMIT_FOR_MANAGER_CONFIRMATION";
    if (st === "AWAITING_CONFIRMATION") return "MANAGER_CONFIRM_AND_POST";
    if (st === "POSTED") return "COMPLETED";
  }
  return "REVIEW_INBOUND";
}

export async function listBranchInboundQueue(branchId: number, orgId: number): Promise<BranchInboundQueueItem[]> {
  const unified = await getIncomingInboundUnifiedForBranch(branchId, orgId);
  const receivable = unified.filter((r) => r.receivable);

  const srIds = [...new Set(receivable.map((r) => r.stockRequestId).filter((x): x is number => x != null))];
  const srs =
    srIds.length > 0
      ? await prisma.stockRequest.findMany({
          where: { id: { in: srIds } },
          select: {
            id: true,
            status: true,
            allocationPlans: {
              where: { parentPlanId: null },
              take: 1,
              select: { status: true, totalAllocatedQty: true, shortageQty: true },
            },
            dispatches: { select: { status: true } },
          },
        })
      : [];
  const srMap = new Map(srs.map((s) => [s.id, s]));

  const dispatchIds = receivable.filter((r) => r.kind === "DISPATCH").map((r) => r.id);
  const sessions =
    dispatchIds.length > 0
      ? await prisma.dispatchReceiveSession.findMany({
          where: { stockDispatchId: { in: dispatchIds } },
          select: {
            id: true,
            stockDispatchId: true,
            status: true,
            submittedAt: true,
            confirmedAt: true,
          },
        })
      : [];
  const sessByDispatch = new Map(sessions.map((s) => [s.stockDispatchId, s]));

  const out: BranchInboundQueueItem[] = [];

  for (const row of receivable) {
    const inboundCtx = hasInboundContext(row);
    const stockRequest = row.stockRequestId != null ? srMap.get(row.stockRequestId) ?? null : null;

    const primaryPlan = stockRequest?.allocationPlans?.[0] ?? null;
    const effectiveStatus: StockRequestStatus = stockRequest
      ? deriveRequestStatus(
          { status: stockRequest.status },
          primaryPlan,
          stockRequest.dispatches ?? null
        )
      : "DISPATCHED";

    const receiveActionable = stockRequest
      ? isBranchInboundActionable({ status: stockRequest.status }, inboundCtx)
      : true;

    if (!receiveActionable) continue;

    const qtyExpected = row.items.reduce((s, i) => s + i.quantity, 0);
    const qtyReceived = row.items.reduce((s, i) => s + i.quantityReceived, 0);

    let dispatchReceiveSession: BranchInboundDispatchReceiveSession | null = null;
    if (row.kind === "DISPATCH") {
      const s = sessByDispatch.get(row.id);
      if (s) {
        dispatchReceiveSession = {
          id: s.id,
          status: s.status,
          submittedAt: s.submittedAt,
          confirmedAt: s.confirmedAt,
        };
      }
    }

    const nextReceiveAction = computeNextReceiveAction({
      kind: row.kind,
      dispatchStatus: row.status,
      session: dispatchReceiveSession,
    });

    out.push({
      kind: row.kind,
      inboundId: row.id,
      status: row.status,
      fromLocation: row.fromLocation,
      toLocation: row.toLocation,
      quantitiesExpected: qtyExpected,
      quantitiesReceived: qtyReceived,
      lineCount: row.items.length,
      receiveActionable,
      linkedStockRequestId: row.stockRequestId,
      effectiveStatus,
      effectiveStatusDisplay: getStatusDisplay(effectiveStatus),
      dispatchReceiveSession,
      nextReceiveAction,
      items: row.items,
      createdAt: row.createdAt,
    });
  }

  return out;
}
