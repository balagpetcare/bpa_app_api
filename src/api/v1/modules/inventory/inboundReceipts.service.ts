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
  fromLocation: { id: number; name: string };
  toLocation: { id: number; name: string; branchId: number };
  items: InboundUnifiedLine[];
  createdAt: Date;
  inTransitAt: Date | null;
  sentAt: Date | null;
};

const dispatchReceivableStatuses = ["IN_TRANSIT"] as const;
const dispatchListStatuses = ["PACKED", "IN_TRANSIT"] as const;

const transferReceivableStatuses = ["SENT", "IN_TRANSIT"] as const;

function mapDispatchRow(d: any): InboundUnifiedRow {
  const receivable = dispatchReceivableStatuses.includes(d.status as (typeof dispatchReceivableStatuses)[number]);
  return {
    kind: "DISPATCH",
    id: d.id,
    status: d.status,
    receivable,
    stockRequestId: d.stockRequestId,
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
  return {
    kind: "TRANSFER",
    id: t.id,
    status: t.status,
    receivable,
    stockRequestId: t.stockRequestId,
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
 * Incoming shipments to a branch: dispatches (PACKED or IN_TRANSIT) + transfers (SENT or IN_TRANSIT).
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
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true, branchId: true } },
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
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true, branchId: true } },
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
