/**
 * Unified inbound queue for branch receiving: StockDispatch (challan) + StockTransfer (legacy fulfill path).
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export type InboundUnifiedKind = "DISPATCH" | "TRANSFER";

export type InboundUnifiedLine = {
  variantId: number;
  sku: string | null;
  title: string | null;
  lotId: number | null;
  quantity: number;
  quantityReceived: number;
};

export type InboundUnifiedRow = {
  kind: InboundUnifiedKind;
  id: number;
  status: string;
  receivable: boolean;
  stockRequestId: number | null;
  /** SR # / MR # style label for UI */
  requestRef: string | null;
  /** Source warehouse name or originating branch context */
  sourceLabel: string | null;
  /** Destination branch name (toLocation.branch) */
  destinationBranchName: string | null;
  /** Short hint for next step (receive vs wait for send) */
  nextActionHint: string | null;
  fromLocation: { id: number; name: string };
  toLocation: { id: number; name: string; branchId: number };
  items: InboundUnifiedLine[];
  createdAt: Date;
  inTransitAt: Date | null;
  sentAt: Date | null;
};

const dispatchReceivableStatuses = ["IN_TRANSIT"] as const;
/** Include CREATED so branch sees challans immediately after warehouse handoff (before send). */
const dispatchListStatuses = ["CREATED", "PACKED", "IN_TRANSIT"] as const;

const transferReceivableStatuses = ["SENT", "IN_TRANSIT"] as const;

function mapDispatchRow(d: any): InboundUnifiedRow {
  const receivable = dispatchReceivableStatuses.includes(d.status as (typeof dispatchReceivableStatuses)[number]);
  const mr = d.medicineRequisitions?.[0];
  const requestRef =
    d.stockRequestId != null
      ? `SR #${d.stockRequestId}`
      : mr
        ? `MR #${mr.id}${mr.requisitionNumber ? ` (${mr.requisitionNumber})` : ""}`
        : null;
  const sourceLabel =
    d.fromLocation?.warehouse?.name ??
    d.fromLocation?.branch?.name ??
    d.fromLocation?.name ??
    null;
  const destinationBranchName = d.toLocation?.branch?.name ?? null;
  const nextActionHint = receivable
    ? "Receive at this branch (dispatch receive session / GRN)"
    : d.status === "CREATED" || d.status === "PACKED"
      ? "Awaiting warehouse Send dispatch — branch receive only after IN_TRANSIT"
      : "Not receivable yet";
  return {
    kind: "DISPATCH",
    id: d.id,
    status: d.status,
    receivable,
    stockRequestId: d.stockRequestId,
    requestRef,
    sourceLabel,
    destinationBranchName,
    nextActionHint,
    fromLocation: { id: d.fromLocation.id, name: d.fromLocation.name },
    toLocation: {
      id: d.toLocation.id,
      name: d.toLocation.name,
      branchId: d.toLocation.branchId,
    },
    items: d.items.map((i) => ({
      variantId: i.variantId,
      sku: i.variant?.sku ?? null,
      title: i.variant?.title ?? null,
      lotId: i.lot?.id ?? null,
      quantity: i.quantityDispatched,
      quantityReceived: i.quantityReceived,
    })),
    createdAt: d.createdAt,
    inTransitAt: d.inTransitAt,
    sentAt: null,
  };
}

function mapTransferRow(t: any): InboundUnifiedRow {
  const receivable = transferReceivableStatuses.includes(t.status as (typeof transferReceivableStatuses)[number]);
  const requestRef = t.stockRequestId != null ? `SR #${t.stockRequestId}` : null;
  const sourceLabel =
    t.fromLocation?.warehouse?.name ?? t.fromLocation?.branch?.name ?? t.fromLocation?.name ?? null;
  const destinationBranchName = t.toLocation?.branch?.name ?? null;
  const nextActionHint = receivable ? "Legacy transfer receive" : "Not receivable yet";
  return {
    kind: "TRANSFER",
    id: t.id,
    status: t.status,
    receivable,
    stockRequestId: t.stockRequestId,
    requestRef,
    sourceLabel,
    destinationBranchName,
    nextActionHint,
    fromLocation: { id: t.fromLocation.id, name: t.fromLocation.name },
    toLocation: {
      id: t.toLocation.id,
      name: t.toLocation.name,
      branchId: t.toLocation.branchId,
    },
    items: t.items.map((i) => ({
      variantId: i.variantId,
      sku: i.variant?.sku ?? null,
      title: i.variant?.title ?? null,
      lotId: i.lotId,
      quantity: i.quantitySent,
      quantityReceived: i.quantityReceived,
    })),
    createdAt: t.createdAt,
    inTransitAt: null,
    sentAt: t.sentAt,
  };
}

/**
 * Incoming shipments to a branch: enterprise dispatches (CREATED, PACKED, IN_TRANSIT) + legacy transfers (SENT or IN_TRANSIT).
 * Merged descending by createdAt.
 */
export async function getIncomingInboundUnifiedForBranch(branchId: number, orgId?: number): Promise<InboundUnifiedRow[]> {
  const toBranchFilter = {
    branchId,
    ...(orgId != null ? { branch: { orgId } } : {}),
  };

  const dispatchWhere: Record<string, unknown> = {
    toLocation: toBranchFilter,
    status: { in: [...dispatchListStatuses] },
  };
  if (orgId != null) dispatchWhere.orgId = orgId;

  const [dispatches, transfers] = await Promise.all([
    prisma.stockDispatch.findMany({
      where: dispatchWhere,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        fromLocation: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        toLocation: {
          select: {
            id: true,
            name: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
        medicineRequisitions: { select: { id: true, requisitionNumber: true }, take: 1 },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true } },
          },
        },
      },
    }),
    prisma.stockTransfer.findMany({
      where: {
        toLocation: toBranchFilter,
        status: { in: [...transferReceivableStatuses] },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        fromLocation: {
          select: {
            id: true,
            name: true,
            branch: { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        toLocation: {
          select: {
            id: true,
            name: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
      },
    }),
  ]);

  const rows: InboundUnifiedRow[] = [...dispatches.map(mapDispatchRow), ...transfers.map(mapTransferRow)];

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return rows;
}
