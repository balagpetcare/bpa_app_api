import prisma from "../../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { allocateVariantFifo, getMaxDispatchableQtyAtLocation } from "../inventory/fefoAllocation.service";
import { isLotExpiredByCalendarDayUtc } from "../inventory/lotExpiryCalendar";
import { buildAvailabilityDiagnosticsForRequest } from "./stockRequestAvailabilityDiagnostics";
const transfersService = require("../transfers/transfers.service");
const ledgerService = require("../inventory/ledger.service");

async function auditStockRequestLifecycle(opts: {
  orgId: number;
  branchId: number;
  action: string;
  stockRequestId: number;
  actorUserId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await logWarehouseAudit({
      orgId: opts.orgId,
      warehouseId: null,
      category: "OPERATIONS",
      action: opts.action,
      entityType: "StockRequest",
      entityId: String(opts.stockRequestId),
      metadata: { branchId: opts.branchId, ...(opts.metadata ?? {}) },
      actorUserId: opts.actorUserId ?? null,
    });
  } catch (e: any) {
    console.warn("auditStockRequestLifecycle", e?.message);
  }
}

export type CreateRequestInput = {
  orgId: number;
  branchId: number;
  requesterUserId: number;
  items: Array<{ productId: number; variantId: number; requestedQty: number; note?: string }>;
  requestIntent?: "INTERNAL_TRANSFER" | "PROCUREMENT";
  procurementNote?: string;
  preferredVendorId?: number;
  urgency?: string;
};

export type ListRequestsFilter = {
  branchIds?: number[];
  orgId?: number;
  status?: string;
  requestIntent?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

export type DispatchInput = {
  fromLocationId: number;
  toLocationId: number;
  items: Array<{
    variantId: number;
    lotId: number | null;
    quantity: number;
    stockRequestItemId?: number | null;
  }>;
  createdByUserId?: number;
};

export type FlexibleFulfillItemInput = {
  stockRequestItemId?: number;
  variantId?: number;
  fulfillQty: number;
  lots?: Array<{ lotId: number; quantity: number }>;
};

export type FlexibleExtraItemInput = {
  productId: number;
  variantId: number;
  fulfillQty: number;
  lots?: Array<{ lotId: number; quantity: number }>;
};

export type FlexibleFulfillInput = {
  fromLocationId: number;
  toLocationId: number;
  manualMode?: boolean;
  items?: FlexibleFulfillItemInput[];
  extraItems?: FlexibleExtraItemInput[];
  createdByUserId?: number;
};

type InternalDispatchLine = {
  variantId: number;
  lotId: number | null;
  quantity: number;
  stockRequestItemId?: number;
  lineKind: "REQUESTED" | "EXTRA";
};

/**
 * Legacy dispatch payloads only include variantId + quantity (no stockRequestItemId).
 * Allocate each variant's total sent quantity across REQUESTED lines in id order:
 * fill each line up to its remaining capacity, then put any remainder on the last line
 * (allows intentional over-fulfillment on that line only).
 */
function apportionLegacyDispatchQtyByLine(
  requestItems: Array<{
    id: number;
    variantId: number;
    requestedQty: number;
    fulfilledQty: number;
    cancelledQty: number;
    lineKind: string | null;
  }>,
  qtyByVariant: Map<number, number>
): Map<number, number> {
  const incrementByItemId = new Map<number, number>();
  const requested = requestItems
    .filter((i) => i.lineKind !== "EXTRA")
    .sort((a, b) => a.id - b.id);

  const linesByVariant = new Map<number, typeof requested>();
  for (const line of requested) {
    const arr = linesByVariant.get(line.variantId) ?? [];
    arr.push(line);
    linesByVariant.set(line.variantId, arr);
  }

  for (const [variantId, totalSent] of qtyByVariant) {
    if (totalSent <= 0) continue;
    const lines = linesByVariant.get(variantId) ?? [];
    if (!lines.length) continue;
    let left = totalSent;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      const remainingCapacity = Math.max(0, line.requestedQty - line.fulfilledQty - line.cancelledQty);
      const alloc = isLast ? left : Math.min(left, remainingCapacity);
      if (alloc <= 0) continue;
      incrementByItemId.set(line.id, (incrementByItemId.get(line.id) ?? 0) + alloc);
      left -= alloc;
    }
  }
  return incrementByItemId;
}

export type FulfillmentLineError = {
  code: string;
  variantId: number;
  stockRequestItemId?: number;
  /** Original requested qty on the stock request line (REQUESTED lines only). */
  requestedQty?: number;
  fulfillQty: number;
  availableQty: number;
  message: string;
};

export type AcceptedFulfillmentLine = {
  variantId: number;
  stockRequestItemId?: number;
  lineKind: "REQUESTED" | "EXTRA";
  askedQty: number;
  appliedQty: number;
  clamped: boolean;
};

/** Delegates to inventory FEFO + book single source of truth (see fefoAllocation.service). */
function getMaxDispatchableQty(
  orgId: number,
  fromLocationId: number,
  variantId: number
): Promise<number> {
  return getMaxDispatchableQtyAtLocation(orgId, fromLocationId, variantId);
}

/** Ensures dispatch source location belongs to the same org as the stock request (enterprise safety). */
async function assertSourceLocationMatchesRequestOrg(fromLocationId: number, requestOrgId: number) {
  const { resolveOrgIdForLocation } = require("../inventory/stockAvailability.service");
  const locOrg = await resolveOrgIdForLocation(fromLocationId);
  if (locOrg == null) {
    throw new Error("Source location not found or invalid.");
  }
  if (locOrg !== requestOrgId) {
    throw new Error(
      "SOURCE_LOCATION_ORG_MISMATCH: Source location belongs to a different organization than this stock request."
    );
  }
}

/** Max total for explicit lot picks: sum of min(requested per lot, effective on-hand at location). */
async function getMaxExplicitLotsDispatchable(
  fromLocationId: number,
  variantId: number,
  lots: Array<{ lotId: number; quantity: number }>
): Promise<number> {
  let cap = 0;
  for (const l of lots) {
    const lb = await prisma.stockLotBalance.findUnique({
      where: {
        locationId_lotId: { locationId: fromLocationId, lotId: l.lotId },
      },
      include: { lot: { select: { variantId: true } } },
    });
    if (!lb || lb.lot.variantId !== variantId) continue;
    const effective = Math.max(0, lb.onHandQty - lb.reservedQty);
    cap += Math.min(l.quantity, effective);
  }
  return cap;
}

/** Greedy take from listed lots in order; never exceeds effective on-hand per lot (onHand - reserved). */
async function allocateExplicitLotsGreedy(
  fromLocationId: number,
  variantId: number,
  lots: Array<{ lotId: number; quantity: number }>,
  targetTotal: number
): Promise<Array<{ lotId: number; quantity: number }>> {
  let need = targetTotal;
  const out: Array<{ lotId: number; quantity: number }> = [];
  for (const l of lots) {
    if (need <= 0) break;
    const lb = await prisma.stockLotBalance.findUnique({
      where: {
        locationId_lotId: { locationId: fromLocationId, lotId: l.lotId },
      },
      include: { lot: { select: { variantId: true } } },
    });
    if (!lb || lb.lot.variantId !== variantId) continue;
    const effective = Math.max(0, lb.onHandQty - lb.reservedQty);
    const take = Math.min(need, l.quantity, effective);
    if (take > 0) {
      out.push({ lotId: l.lotId, quantity: take });
      need -= take;
    }
  }
  return out;
}

/**
 * Builds physical dispatch rows. Caller must pass fulfillQty ≤ available capacity (validated upstream).
 * Does not throw for insufficient stock — only for invariant violations.
 */
async function expandQtyToDispatchLines(params: {
  orgId: number;
  fromLocationId: number;
  manualMode: boolean;
  variantId: number;
  fulfillQty: number;
  lots?: Array<{ lotId: number; quantity: number }>;
  warnings: Array<{ code: string; message: string }>;
}): Promise<Array<{ variantId: number; lotId: number | null; quantity: number }>> {
  const { orgId, fromLocationId, manualMode, variantId, fulfillQty, lots, warnings } = params;
  if (fulfillQty <= 0) return [];

  if (lots?.length) {
    const sum = lots.reduce((s, l) => s + l.quantity, 0);
    if (sum !== fulfillQty) {
      throw new Error(`Lot quantities must sum to fulfillQty for variant ${variantId}`);
    }
    return lots.map((l) => ({ variantId, lotId: l.lotId, quantity: l.quantity }));
  }

  if (manualMode) {
    const bal = await prisma.stockBalance.findUnique({
      where: { locationId_variantId: { locationId: fromLocationId, variantId } },
    });
    const aggregate = Math.max(0, (bal?.onHandQty ?? 0) - (bal?.reservedQty ?? 0));
    if (fulfillQty <= aggregate) {
      warnings.push({
        code: "NON_LOT_DISPATCH",
        message: `Variant ${variantId}: dispatching ${fulfillQty} units from aggregate stock (manual mode, no lot lines).`,
      });
      return [{ variantId, lotId: null, quantity: fulfillQty }];
    }
    warnings.push({
      code: "MANUAL_FEFO_ALLOCATION",
      message: `Variant ${variantId}: aggregate insufficient for non-lot dispatch; allocating ${fulfillQty} units by FEFO from lots (manual mode).`,
    });
    const slices = await allocateVariantFifo(orgId, fromLocationId, variantId, fulfillQty);
    return slices.map((s) => ({ variantId, lotId: s.lotId, quantity: s.quantity }));
  }

  try {
    const slices = await allocateVariantFifo(orgId, fromLocationId, variantId, fulfillQty);
    return slices.map((s) => ({ variantId, lotId: s.lotId, quantity: s.quantity }));
  } catch {
    warnings.push({
      code: "NON_LOT_FALLBACK",
      message: `Variant ${variantId}: no full FEFO cover; using aggregate (non-lot) dispatch for ${fulfillQty} units.`,
    });
    return [{ variantId, lotId: null, quantity: fulfillQty }];
  }
}

/**
 * Owner: flexible fulfillment — validates per line, clamps to available when possible, structured errors when not.
 */
async function fulfillStockRequestFlexible(requestId: number, input: FlexibleFulfillInput) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");

  // Allow multi-wave dispatch: permit FULFILLED_PARTIAL in addition to SUBMITTED/OWNER_REVIEW
  if (!["SUBMITTED", "OWNER_REVIEW", "FULFILLED_PARTIAL"].includes(request.status)) {
    throw new Error(`Request cannot be dispatched in status ${request.status}`);
  }

  const fulfillItems = input.items ?? [];
  const extraItems = input.extraItems ?? [];
  if (!fulfillItems.length && !extraItems.length) {
    throw new Error("At least one fulfill item or extra item is required");
  }
  const hasPositiveQty =
    fulfillItems.some((f) => (f.fulfillQty ?? 0) > 0) || extraItems.some((e) => (e.fulfillQty ?? 0) > 0);
  if (!hasPositiveQty) {
    throw new Error("At least one fulfillQty must be greater than zero");
  }

  await assertSourceLocationMatchesRequestOrg(input.fromLocationId, request.orgId);

  const warnings: Array<{ code: string; message: string }> = [];
  const lineErrors: FulfillmentLineError[] = [];
  const rejectedLines: FulfillmentLineError[] = [];
  const acceptedLines: AcceptedFulfillmentLine[] = [];
  const internal: InternalDispatchLine[] = [];

  let workingItems = [...request.items];

  for (const ex of extraItems) {
    if (!ex.fulfillQty || ex.fulfillQty <= 0) continue;
    const existing = workingItems.find((i) => i.variantId === ex.variantId && i.lineKind === "EXTRA");
    if (!existing) {
      const created = await prisma.stockRequestItem.create({
        data: {
          stockRequestId: requestId,
          productId: ex.productId,
          variantId: ex.variantId,
          requestedQty: 0,
          fulfilledQty: 0,
          lineKind: "EXTRA",
        },
      });
      workingItems.push(created);
    }
  }

  const orgId = request.orgId;
  const manualMode = Boolean(input.manualMode);
  const fromLocationId = input.fromLocationId;

  async function processLine(opts: {
    fulfillQty: number;
    variantId: number;
    stockRequestItemId?: number;
    lineKind: "REQUESTED" | "EXTRA";
    requestedQty?: number;
    /** Fulfilled qty on this line before this dispatch wave (DB snapshot at start). */
    priorFulfilledQty?: number;
    lots?: Array<{ lotId: number; quantity: number }>;
  }) {
    const ask = opts.fulfillQty;
    if (ask <= 0) return;

    let max: number;
    let lotsToUse = opts.lots;

    if (lotsToUse?.length) {
      max = await getMaxExplicitLotsDispatchable(fromLocationId, opts.variantId, lotsToUse);
    } else {
      max = await getMaxDispatchableQty(orgId, fromLocationId, opts.variantId);
    }

    if (max <= 0 && ask > 0) {
      const err: FulfillmentLineError = {
        code: "INSUFFICIENT_STOCK",
        variantId: opts.variantId,
        stockRequestItemId: opts.stockRequestItemId,
        requestedQty: opts.requestedQty,
        fulfillQty: ask,
        availableQty: 0,
        message: `Requested ${ask}, available 0 at this location for variant ${opts.variantId}. Reload availability or choose another source location.`,
      };
      lineErrors.push(err);
      rejectedLines.push(err);
      return;
    }

    let applied = Math.min(ask, max);
    if (applied < ask && max > 0) {
      warnings.push({
        code: "FULFILL_QTY_CLAMPED",
        message: `Variant ${opts.variantId}: asked ${ask}, only ${max} available; dispatching ${applied}.`,
      });
    }

    if (lotsToUse?.length) {
      lotsToUse = await allocateExplicitLotsGreedy(
        fromLocationId,
        opts.variantId,
        lotsToUse,
        applied
      );
      const sumLots = lotsToUse.reduce((s, l) => s + l.quantity, 0);
      if (sumLots !== applied) {
        applied = sumLots;
      }
    }

    if (
      opts.lineKind === "REQUESTED" &&
      opts.requestedQty != null &&
      (opts.priorFulfilledQty ?? 0) + applied > opts.requestedQty
    ) {
      const total = (opts.priorFulfilledQty ?? 0) + applied;
      warnings.push({
        code: "OVER_FULFILLMENT",
        message: `Item #${opts.stockRequestItemId}: total fulfilled after this dispatch (${total}) exceeds requestedQty ${opts.requestedQty} (this wave: ${applied}).`,
      });
    }

    acceptedLines.push({
      variantId: opts.variantId,
      stockRequestItemId: opts.stockRequestItemId,
      lineKind: opts.lineKind,
      askedQty: ask,
      appliedQty: applied,
      clamped: applied < ask,
    });

    const lines = await expandQtyToDispatchLines({
      orgId,
      fromLocationId,
      manualMode,
      variantId: opts.variantId,
      fulfillQty: applied,
      lots: lotsToUse,
      warnings,
    });
    for (const ln of lines) {
      internal.push({
        variantId: ln.variantId,
        lotId: ln.lotId,
        quantity: ln.quantity,
        stockRequestItemId: opts.stockRequestItemId,
        lineKind: opts.lineKind,
      });
    }
  }

  const cancelledLines: number[] = [];

  for (const fi of fulfillItems) {
    if (!fi.fulfillQty || fi.fulfillQty <= 0) continue;
    const sid = fi.stockRequestItemId != null ? Number(fi.stockRequestItemId) : NaN;
    if (!Number.isFinite(sid) || sid <= 0) {
      throw new Error(
        "Each fulfill item must include a valid stockRequestItemId (variant-only matching is disabled to prevent wrong-line fulfillment when duplicate variants exist)."
      );
    }
    const row = workingItems.find((i) => i.id === sid);
    if (!row || row.lineKind === "EXTRA") {
      throw new Error(`Fulfill item references unknown or invalid stock request line #${sid} (must be a REQUESTED line)`);
    }

    // Skip fully cancelled lines
    const remainingQty = row.requestedQty - row.fulfilledQty - row.cancelledQty;
    if (remainingQty <= 0) {
      cancelledLines.push(row.id);
      warnings.push({
        code: "LINE_FULLY_CANCELLED",
        message: `Line #${row.id} (variant ${row.variantId}): skipped because remaining quantity is 0 (requested ${row.requestedQty}, fulfilled ${row.fulfilledQty}, cancelled ${row.cancelledQty}).`,
      });
      continue;
    }

    await processLine({
      fulfillQty: fi.fulfillQty,
      variantId: row.variantId,
      stockRequestItemId: row.id,
      lineKind: "REQUESTED",
      requestedQty: row.requestedQty,
      priorFulfilledQty: row.fulfilledQty,
      lots: fi.lots,
    });
  }

  for (const ex of extraItems) {
    if (!ex.fulfillQty || ex.fulfillQty <= 0) continue;
    const row = workingItems.find((i) => i.variantId === ex.variantId && i.lineKind === "EXTRA");
    if (!row) throw new Error(`Extra line not created for variant ${ex.variantId}`);
    await processLine({
      fulfillQty: ex.fulfillQty,
      variantId: ex.variantId,
      stockRequestItemId: row.id,
      lineKind: "EXTRA",
      priorFulfilledQty: row.fulfilledQty,
      lots: ex.lots,
    });
  }

  const dispatchRows = internal.map((i) => ({
    variantId: i.variantId,
    lotId: i.lotId,
    quantity: i.quantity,
    stockRequestItemId: i.stockRequestItemId ?? null,
  }));

  const dispatched = dispatchRows.length > 0;

  if (!dispatched) {
    return {
      transfer: null,
      fulfillment: {
        dispatched: false,
        message: "No quantity could be dispatched. See lineErrors.",
        requestedQty: workingItems
          .filter((i) => i.lineKind === "REQUESTED" || i.lineKind == null)
          .reduce((s, i) => s + i.requestedQty, 0),
        fulfilledQty: 0,
        remainingQty: 0,
        overFulfilledQty: 0,
        warnings,
        lineErrors,
        rejectedLines,
        acceptedLines,
        cancelledLines: cancelledLines.map(id => ({ itemId: id })),
        /** Future: allowDispatchWithApproval, backorder — disabled by default */
        extensions: { backorder: "NOT_ENABLED", forceDispatch: "NOT_ENABLED" },
      },
    };
  }

  const transferId = await dispatchRequest(requestId, {
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    items: dispatchRows,
    createdByUserId: input.createdByUserId,
  });
  await transfersService.sendTransfer(transferId, input.createdByUserId);

  const byItemId = new Map<number, number>();
  for (const line of internal) {
    if (line.stockRequestItemId) {
      byItemId.set(line.stockRequestItemId, (byItemId.get(line.stockRequestItemId) ?? 0) + line.quantity);
    }
  }
  if (byItemId.size > 0) {
    await prisma.$transaction(
      [...byItemId.entries()].map(([itemId, qty]) =>
        prisma.stockRequestItem.update({
          where: { id: itemId },
          data: { fulfilledQty: { increment: qty } },
        })
      )
    );
  }

  const requestedLines = workingItems.filter((i) => i.lineKind === "REQUESTED" || i.lineKind == null);
  const totalRequested = requestedLines.reduce((s, i) => s + i.requestedQty, 0);
  let fulfilledTotalRequested = 0;
  for (const line of requestedLines) {
    const inc = byItemId.get(line.id) ?? 0;
    fulfilledTotalRequested += line.fulfilledQty + inc;
  }
  const remainingQty = Math.max(0, totalRequested - fulfilledTotalRequested);
  const overFulfilledQty = Math.max(0, fulfilledTotalRequested - totalRequested);

  const nextStatus =
    fulfilledTotalRequested < totalRequested ? "FULFILLED_PARTIAL" : "DISPATCHED";
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: nextStatus },
  });

  const transfer = await transfersService.getTransferById(transferId);
  return {
    transfer,
    fulfillment: {
      dispatched: true,
      message: rejectedLines.length ? "Dispatched with some lines rejected (see lineErrors)." : "Dispatched",
      requestedQty: totalRequested,
      fulfilledQty: fulfilledTotalRequested,
      remainingQty,
      overFulfilledQty,
      warnings,
      lineErrors,
      rejectedLines,
      acceptedLines,
      cancelledLines: cancelledLines.map(id => ({ itemId: id })),
      extensions: { backorder: "NOT_ENABLED", forceDispatch: "NOT_ENABLED" },
    },
  };
}

/**
 * Detect if branch is a warehouse hub; if so, default intent to PROCUREMENT.
 */
async function resolveRequestIntent(
  branchId: number,
  explicitIntent?: "INTERNAL_TRANSFER" | "PROCUREMENT"
): Promise<"INTERNAL_TRANSFER" | "PROCUREMENT"> {
  if (explicitIntent) return explicitIntent;
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });
  const WAREHOUSE_HUB_CODES = new Set(["WAREHOUSE_DC", "WAREHOUSE", "CENTRAL_WAREHOUSE", "DISTRIBUTION_CENTER"]);
  const isWarehouse = (branch?.typeLinks ?? []).some((t: any) => WAREHOUSE_HUB_CODES.has(t.branchType.code));
  return isWarehouse ? "PROCUREMENT" : "INTERNAL_TRANSFER";
}

/**
 * Create draft stock request (branch). No batch; product/variant + qty only.
 * Auto-detects requestIntent from branch type if not explicitly provided.
 */
async function createRequest(data: CreateRequestInput) {
  if (!data.items?.length) {
    throw new Error("At least one item is required");
  }
  for (const item of data.items) {
    if (!item.variantId || !item.requestedQty || item.requestedQty <= 0) {
      throw new Error("Each item must have variantId and positive requestedQty");
    }
  }

  const intent = await resolveRequestIntent(data.branchId, data.requestIntent);

  const request = await prisma.stockRequest.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      requesterUserId: data.requesterUserId,
      status: "DRAFT",
      requestIntent: intent,
      procurementNote: data.procurementNote ?? null,
      preferredVendorId: data.preferredVendorId ?? null,
      urgency: data.urgency ?? null,
      items: {
        create: data.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          requestedQty: i.requestedQty,
          note: i.note ?? null,
        })),
      },
    },
    include: {
      branch: { select: { id: true, name: true, orgId: true } },
      requester: { select: { id: true, profile: { select: { displayName: true } } } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
    },
  });
  return request;
}

/**
 * List stock requests with filters. Use branchIds (branch scope) or orgId (owner scope).
 */
async function listRequests(filter: ListRequestsFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filter.branchIds?.length) where.branchId = { in: filter.branchIds };
  if (filter.orgId) where.orgId = filter.orgId;
  if (filter.status) where.status = filter.status;
  if (filter.requestIntent) where.requestIntent = filter.requestIntent;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
    if (filter.dateTo) {
      const d = new Date(filter.dateTo);
      d.setHours(23, 59, 59, 999);
      where.createdAt.lte = d;
    }
  }

  const [items, total] = await Promise.all([
    prisma.stockRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
        transfers: {
          select: { id: true, status: true, sentAt: true, receivedAt: true },
          take: 1,
        },
      },
    }),
    prisma.stockRequest.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get single request by id. Optionally include available lots per variant at fromLocationId (for owner fulfill UI).
 */
async function getRequestById(
  requestId: number,
  options?: { fromLocationId?: number }
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: {
      org: { select: { id: true, name: true } },
      branch: {
        select: {
          id: true,
          name: true,
          inventoryLocations: {
            where: { isActive: true },
            select: { id: true, name: true, type: true },
          },
        },
      },
      requester: { select: { id: true, profile: { select: { displayName: true } } } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          variant: { select: { id: true, sku: true, title: true } },
          cancelledBy: { select: { id: true, profile: { select: { displayName: true } } } },
        },
      },
      transfers: {
        include: {
          fromLocation: { select: { id: true, name: true } },
          toLocation: { select: { id: true, name: true } },
          items: {
            include: {
              variant: { select: { id: true, sku: true, title: true } },
              lot: { select: { id: true, lotCode: true, expDate: true } },
            },
          },
        },
      },
    },
  });

  if (!request) return null;

  // Add computed fields to each item
  const enhancedItems = request.items.map((item: any) => {
    const remainingQty = item.requestedQty - item.fulfilledQty - item.cancelledQty;
    let lineStatus = 'PENDING';
    if (item.lineKind === 'EXTRA') {
      lineStatus = 'EXTRA';
    } else if (item.cancelledQty === item.requestedQty) {
      lineStatus = 'CANCELLED';
    } else if (item.fulfilledQty >= item.requestedQty) {
      lineStatus = item.fulfilledQty > item.requestedQty ? 'OVER_FULFILLED' : 'FULFILLED';
    } else if (item.fulfilledQty > 0) {
      lineStatus = 'PARTIAL';
    } else if (item.cancelledQty > 0) {
      lineStatus = 'PARTIAL_CANCELLED';
    }

    return {
      ...item,
      remainingQty,
      lineStatus,
    };
  });

  (request as any).items = enhancedItems;

  if (options?.fromLocationId && request.items?.length) {
    const { resolveOrgIdForLocation } = require("../inventory/stockAvailability.service");
    const sourceOrgId = await resolveOrgIdForLocation(options.fromLocationId);

    const attachEmptyFulfillmentWithValidation = (validation: Record<string, unknown>) => {
      (request as any).fulfillmentSourceValidation = validation;
      (request as any).availableLotsByVariant = {};
      (request as any).aggregateStockByVariant = {};
      (request as any).maxDispatchableByVariant = {};
      (request as any).maxDispatchableByItemId = {};
      (request as any).lineWarnings = {};
      const requestedLines = enhancedItems.filter((i: any) => i.lineKind !== "EXTRA");
      const totalRequestedQty = requestedLines.reduce((sum: number, i: any) => sum + i.requestedQty, 0);
      const totalFulfilledQty = enhancedItems.reduce((sum: number, i: any) => sum + i.fulfilledQty, 0);
      const totalCancelledQty = requestedLines.reduce((sum: number, i: any) => sum + i.cancelledQty, 0);
      const totalRemainingQty = requestedLines.reduce((sum: number, i: any) => sum + (i.remainingQty || 0), 0);
      const linesByStatus: Record<string, number> = {};
      for (const item of enhancedItems) {
        const status = (item as any).lineStatus;
        linesByStatus[status] = (linesByStatus[status] || 0) + 1;
      }
      (request as any).summary = {
        totalRequestedQty,
        totalFulfilledQty,
        totalCancelledQty,
        totalRemainingQty,
        totalMaxDispatchable: 0,
        linesByStatus,
      };
    };

    if (sourceOrgId == null) {
      attachEmptyFulfillmentWithValidation({
        ok: false,
        code: "SOURCE_LOCATION_NOT_FOUND",
        message:
          "The selected source location was not found or is not linked to a branch. Choose a valid warehouse or hub.",
        fromLocationId: options.fromLocationId,
        requestOrgId: request.orgId,
      });
    } else if (sourceOrgId !== request.orgId) {
      attachEmptyFulfillmentWithValidation({
        ok: false,
        code: "SOURCE_LOCATION_ORG_MISMATCH",
        message:
          "The selected source location belongs to a different organization than this stock request. Choose a warehouse or hub under the same organization.",
        fromLocationId: options.fromLocationId,
        requestOrgId: request.orgId,
        locationOrgId: sourceOrgId,
      });
    } else {
    const variantIds = [...new Set(request.items.map((i: any) => i.variantId))];
    const orgId = request.orgId;

    // Enhanced lot balances with metadata
    const lotBalances = await prisma.stockLotBalance.findMany({
      where: {
        locationId: options.fromLocationId,
        onHandQty: { gt: 0 },
        lot: {
          orgId,
          variantId: { in: variantIds },
        },
      },
      include: {
        lot: {
          select: {
            id: true,
            variantId: true,
            lotCode: true,
            mfgDate: true,
            expDate: true,
          },
        },
      },
      orderBy: { lot: { expDate: 'asc' } },
    });

    // Get QC holds and recall status
    const lotIds = lotBalances.map(lb => lb.lotId);
    const { getFrozenRecallLotIds, getPendingQcHoldByLot } = require("../inventory/stockAvailability.service");
    const [recallFrozen, qcPending] = await Promise.all([
      getFrozenRecallLotIds(orgId, lotIds),
      getPendingQcHoldByLot(orgId, options.fromLocationId),
    ]);

    const now = new Date();
    const nearExpiryDays = 30;
    const nearExpiryDate = new Date(now.getTime() + nearExpiryDays * 24 * 60 * 60 * 1000);

    // Group lots by variant with enhanced metadata
    const byVariant: Record<number, any[]> = {};
    const fefoRankByVariant: Record<number, number> = {};

    for (const lb of lotBalances) {
      if (lb.onHandQty <= 0) continue;
      const v = lb.lot.variantId;
      if (!byVariant[v]) {
        byVariant[v] = [];
        fefoRankByVariant[v] = 1;
      }

      const qcBlock = qcPending.get(lb.lotId) ?? 0;
      const effectiveAvailable = Math.max(0, lb.onHandQty - lb.reservedQty - qcBlock);
      const isExpired = isLotExpiredByCalendarDayUtc(lb.lot.expDate, now);
      const isNearExpiry = !isExpired && lb.lot.expDate > now && lb.lot.expDate <= nearExpiryDate;
      const isRecalled = recallFrozen.has(lb.lotId);
      const isQcHeld = qcBlock > 0;

      byVariant[v].push({
        lotId: lb.lot.id,
        lotCode: lb.lot.lotCode,
        mfgDate: lb.lot.mfgDate,
        expDate: lb.lot.expDate,
        onHandQty: lb.onHandQty,
        reservedQty: lb.reservedQty,
        effectiveAvailable,
        isExpired,
        isNearExpiry,
        isRecalled,
        isQcHeld,
        fefoRank: fefoRankByVariant[v]++,
      });
    }
    (request as any).availableLotsByVariant = byVariant;

    // Aggregate stock by variant with reservedQty
    const balances = await prisma.stockBalance.findMany({
      where: {
        locationId: options.fromLocationId,
        variantId: { in: variantIds },
      },
      select: { variantId: true, onHandQty: true, reservedQty: true },
    });
    (request as any).aggregateStockByVariant = Object.fromEntries(
      balances.map((b) => [b.variantId, Math.max(0, b.onHandQty - b.reservedQty)])
    );

    // Max dispatchable by variant (uses updated getMaxDispatchableQty with reservedQty)
    const maxDispatchableByVariant: Record<number, number> = {};
    for (const vid of variantIds) {
      maxDispatchableByVariant[vid] = await getMaxDispatchableQty(orgId, options.fromLocationId, vid);
    }
    (request as any).maxDispatchableByVariant = maxDispatchableByVariant;

    // Per-line cap when multiple REQUESTED lines share a variant (shared pool at source location)
    const maxDispatchableByItemId: Record<number, number> = {};
    const poolLeft = new Map<number, number>();
    for (const vid of variantIds) {
      poolLeft.set(vid, maxDispatchableByVariant[vid] ?? 0);
    }
    const requestedOrdered = enhancedItems
      .filter((i: any) => i.lineKind !== "EXTRA")
      .sort((a: any, b: any) => a.id - b.id);
    for (const item of requestedOrdered) {
      const v = item.variantId;
      const rem = (item as any).remainingQty ?? 0;
      const pool = poolLeft.get(v) ?? 0;
      const lineMax = Math.min(rem, pool);
      maxDispatchableByItemId[item.id] = lineMax;
      poolLeft.set(v, Math.max(0, pool - lineMax));
    }
    (request as any).maxDispatchableByItemId = maxDispatchableByItemId;

    try {
      (request as any).availabilityDiagnosticsByVariant = await buildAvailabilityDiagnosticsForRequest(
        orgId,
        options.fromLocationId,
        variantIds
      );
    } catch {
      (request as any).availabilityDiagnosticsByVariant = null;
    }

    // Generate line warnings
    const lineWarnings: Record<number, any[]> = {};
    for (const item of enhancedItems) {
      if (item.lineKind === 'EXTRA') continue;
      const warnings: any[] = [];
      const remainingNeed =
        (item as any).remainingQty ??
        Math.max(0, item.requestedQty - item.fulfilledQty - item.cancelledQty);
      const maxDisp =
        maxDispatchableByItemId[item.id] ?? maxDispatchableByVariant[item.variantId] ?? 0;

      if (remainingNeed > 0 && maxDisp === 0) {
        warnings.push({
          code: 'NO_STOCK',
          message: 'No stock available at selected location for remaining quantity on this line',
          severity: 'RED'
        });
      } else if (remainingNeed > 0 && maxDisp < remainingNeed) {
        warnings.push({
          code: 'LOW_STOCK',
          message: `Only ${maxDisp} available for this line (${remainingNeed} remaining to fulfill)`,
          severity: 'AMBER'
        });
      }

      const lots = byVariant[item.variantId] || [];
      const nearExpiryLots = lots.filter(l => l.isNearExpiry && !l.isExpired);
      if (nearExpiryLots.length > 0) {
        const earliest = nearExpiryLots[0];
        const daysLeft = Math.ceil((earliest.expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        warnings.push({
          code: 'NEAR_EXPIRY',
          message: `Earliest lot expires in ${daysLeft} days`,
          severity: 'AMBER'
        });
      }

      const recalledLots = lots.filter(l => l.isRecalled);
      if (recalledLots.length > 0) {
        warnings.push({
          code: 'RECALLED_LOT_EXCLUDED',
          message: `${recalledLots.length} lot(s) excluded due to recall`,
          severity: 'AMBER'
        });
      }

      if (warnings.length > 0) {
        lineWarnings[item.id] = warnings;
      }
    }
    (request as any).lineWarnings = lineWarnings;

    // Summary
    const requestedLines = enhancedItems.filter((i: any) => i.lineKind !== "EXTRA");
    const totalRequestedQty = requestedLines.reduce((sum: number, i: any) => sum + i.requestedQty, 0);
    const totalFulfilledQty = enhancedItems.reduce((sum: number, i: any) => sum + i.fulfilledQty, 0);
    const totalCancelledQty = requestedLines.reduce((sum: number, i: any) => sum + i.cancelledQty, 0);
    const totalRemainingQty = requestedLines.reduce((sum: number, i: any) => sum + (i.remainingQty || 0), 0);
    const totalMaxDispatchable = requestedLines.reduce((sum: number, i: any) => {
      const max = maxDispatchableByItemId[i.id] ?? maxDispatchableByVariant[i.variantId] ?? 0;
      return sum + Math.min(max, i.remainingQty || 0);
    }, 0);

    const linesByStatus: Record<string, number> = {};
    for (const item of enhancedItems) {
      const status = (item as any).lineStatus;
      linesByStatus[status] = (linesByStatus[status] || 0) + 1;
    }

    (request as any).summary = {
      totalRequestedQty,
      totalFulfilledQty,
      totalCancelledQty,
      totalRemainingQty,
      totalMaxDispatchable,
      linesByStatus,
    };
    (request as any).fulfillmentSourceValidation = { ok: true };
    }
  }

  return request;
}

/**
 * Update request items (draft only). Replaces items.
 */
async function updateRequestItems(
  requestId: number,
  items: Array<{ productId: number; variantId: number; requestedQty: number; note?: string }>
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT") {
    throw new Error("Only DRAFT requests can be updated");
  }
  if (!items?.length) throw new Error("At least one item is required");

  await prisma.$transaction(async (tx) => {
    await tx.stockRequestItem.deleteMany({ where: { stockRequestId: requestId } });
    await tx.stockRequest.update({
      where: { id: requestId },
      data: {
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            requestedQty: i.requestedQty,
            note: i.note ?? null,
          })),
        },
      },
    });
  });

  return getRequestById(requestId);
}

/**
 * Submit request (DRAFT → SUBMITTED).
 */
async function submitRequest(requestId: number) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT") throw new Error("Only DRAFT requests can be submitted");
  if (!req.items?.length) throw new Error("Request has no items");

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  const out = await getRequestById(requestId);
  await auditStockRequestLifecycle({
    orgId: req.orgId,
    branchId: req.branchId,
    action: "STOCK_REQUEST_SUBMIT",
    stockRequestId: requestId,
    actorUserId: req.requesterUserId ?? null,
    metadata: { itemCount: req.items?.length ?? 0 },
  });
  return out;
}

/**
 * Cancel request (DRAFT or SUBMITTED → CANCELLED).
 */
async function cancelRequest(requestId: number) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true, orgId: true, branchId: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "DRAFT" && req.status !== "SUBMITTED") {
    throw new Error("Only DRAFT or SUBMITTED requests can be cancelled");
  }

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  const out = await getRequestById(requestId);
  await auditStockRequestLifecycle({
    orgId: req.orgId,
    branchId: req.branchId,
    action: "STOCK_REQUEST_CANCEL",
    stockRequestId: requestId,
    actorUserId: null,
    metadata: { priorStatus: req.status },
  });
  return out;
}

/**
 * Owner: approve request (optional partial qty per variant + extra items). Status → OWNER_REVIEW.
 */
async function approveRequest(
  requestId: number,
  opts: {
    approvedItems: Array<{ variantId: number; approvedQty: number }>;
    extraItems?: Array<{ variantId: number; quantity: number }>;
    approvedByUserId: number;
  }
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(req.status)) {
    throw new Error(`Request cannot be approved in status ${req.status}`);
  }
  const approvedItems = opts.approvedItems ?? [];
  const extraItems = opts.extraItems ?? [];
  if (!approvedItems.length && !extraItems.length) {
    throw new Error("At least one approved item or extra item is required");
  }
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: {
      status: "OWNER_REVIEW",
      approvedItems: approvedItems as any,
      extraItems: extraItems as any,
      approvedAt: new Date(),
      approvedByUserId: opts.approvedByUserId,
    },
  });
  const out = await getRequestById(requestId);
  await auditStockRequestLifecycle({
    orgId: req.orgId,
    branchId: req.branchId,
    action: "STOCK_REQUEST_APPROVE",
    stockRequestId: requestId,
    actorUserId: opts.approvedByUserId,
    metadata: {
      approvedLineCount: approvedItems.length,
      extraLineCount: extraItems.length,
    },
  });
  return out;
}

/**
 * Owner: decline a submitted stock request with reason/source (auditable).
 */
async function declineRequest(
  requestId: number,
  opts: { reason?: string; source?: string; declinedByUserId: number }
) {
  const req = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: { status: true, orgId: true, branchId: true },
  });
  if (!req) throw new Error("Stock request not found");
  if (req.status !== "SUBMITTED" && req.status !== "OWNER_REVIEW") {
    throw new Error("Only SUBMITTED or OWNER_REVIEW requests can be declined");
  }

  await prisma.stockRequest.update({
    where: { id: requestId },
    data: {
      status: "CANCELLED",
      declinedAt: new Date(),
      declineReason: opts.reason ?? null,
      declineSource: opts.source ?? null,
      declinedByUserId: opts.declinedByUserId,
    },
  });
  const out = await getRequestById(requestId);
  await auditStockRequestLifecycle({
    orgId: req.orgId,
    branchId: req.branchId,
    action: "STOCK_REQUEST_DECLINE",
    stockRequestId: requestId,
    actorUserId: opts.declinedByUserId,
    metadata: { reason: opts.reason ?? null, source: opts.source ?? null },
  });
  return out;
}

/**
 * Owner: Create transfer from request (DRAFT, linked to request). Used by fulfillAndDispatch.
 */
async function dispatchRequest(requestId: number, data: DispatchInput): Promise<number> {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true, branch: { select: { id: true } } },
  });
  if (!request) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(request.status)) {
    throw new Error(`Request cannot be dispatched in status ${request.status}`);
  }
  if (!data.items?.length) throw new Error("At least one dispatch item is required");

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromLocationId: data.fromLocationId,
      toLocationId: data.toLocationId,
      status: "DRAFT",
      stockRequestId: requestId,
      createdByUserId: data.createdByUserId ?? null,
      items: {
        create: data.items.map((i: any) => ({
          variantId: i.variantId,
          lotId: i.lotId ?? null,
          stockRequestItemId: i.stockRequestItemId != null ? Number(i.stockRequestItemId) : null,
          quantitySent: i.quantity,
          quantityReceived: 0,
          quantityDamaged: 0,
          quantityExpired: 0,
        })),
      },
    },
  });
  return transfer.id;
}

/**
 * Called after transfer is sent: update request status to DISPATCHED.
 */
export async function markRequestDispatched(requestId: number, _fullFulfilled?: boolean) {
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: "DISPATCHED" },
  });
}

/**
 * Called when transfer is received: update linked request to RECEIVED_PARTIAL or RECEIVED_FULL.
 */
export async function markRequestReceivedIfLinked(transferId: number, fullReceived: boolean) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id: transferId },
    select: { stockRequestId: true },
  });
  if (!transfer?.stockRequestId) return;
  await prisma.stockRequest.update({
    where: { id: transfer.stockRequestId },
    data: { status: fullReceived ? "RECEIVED_FULL" : "RECEIVED_PARTIAL" },
  });
}

/**
 * Enterprise dispatch receive path: set StockRequest status from aggregate dispatch DO state.
 * Invoked inside the same DB transaction as receiveDispatch.
 */
export async function markStockRequestStatusFromDispatchReceive(tx: any, stockRequestId: number): Promise<void> {
  const dispatches = await tx.stockDispatch.findMany({
    where: { stockRequestId },
    select: { id: true, status: true },
  });
  if (!dispatches.length) return;

  const allDispatchesDelivered = dispatches.every((d: { status: string }) => d.status === "DELIVERED");
  if (!allDispatchesDelivered) {
    await tx.stockRequest.update({
      where: { id: stockRequestId },
      data: { status: "PARTIALLY_RECEIVED" },
    });
    return;
  }

  const dispatchItems = await tx.stockDispatchItem.findMany({
    where: { stockDispatch: { stockRequestId } },
    select: {
      quantityDispatched: true,
      quantityReceived: true,
      quantityDamaged: true,
      quantityShort: true,
    },
  });
  const allLinesAccounted = dispatchItems.every(
    (i: {
      quantityDispatched: number;
      quantityReceived: number;
      quantityDamaged: number;
      quantityShort: number;
    }) => i.quantityReceived + i.quantityDamaged + i.quantityShort >= i.quantityDispatched
  );

  await tx.stockRequest.update({
    where: { id: stockRequestId },
    data: { status: allLinesAccounted ? "RECEIVED_FULL" : "PARTIALLY_RECEIVED" },
  });
}

/**
 * Owner: Full dispatch flow — create transfer, send it, update request status.
 * Legacy body: explicit lot lines per variant (lotId may be null for non-lot dispatch).
 */
async function fulfillAndDispatch(requestId: number, data: DispatchInput) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");
  if (!["SUBMITTED", "OWNER_REVIEW"].includes(request.status)) {
    throw new Error(`Request cannot be dispatched in status ${request.status}`);
  }
  if (!data.items?.length) throw new Error("At least one dispatch item is required");

  await assertSourceLocationMatchesRequestOrg(data.fromLocationId, request.orgId);

  const qtyByVariant = new Map<number, number>();
  for (const i of data.items) {
    qtyByVariant.set(i.variantId, (qtyByVariant.get(i.variantId) ?? 0) + i.quantity);
  }

  const transferId = await dispatchRequest(requestId, data);
  await transfersService.sendTransfer(transferId, data.createdByUserId);

  const incrementByItemId = apportionLegacyDispatchQtyByLine(
    request.items as Array<{
      id: number;
      variantId: number;
      requestedQty: number;
      fulfilledQty: number;
      cancelledQty: number;
      lineKind: string | null;
    }>,
    qtyByVariant
  );
  if (incrementByItemId.size > 0) {
    await prisma.$transaction(
      [...incrementByItemId.entries()].map(([itemId, qty]) =>
        prisma.stockRequestItem.update({
          where: { id: itemId },
          data: { fulfilledQty: { increment: qty } },
        })
      )
    );
  }

  const requestedLines = request.items.filter((i) => {
    const lk = (i as { lineKind?: string }).lineKind;
    return lk !== "EXTRA";
  });
  const totalRequested = requestedLines.reduce((s, i) => s + i.requestedQty, 0);
  let fulfilledAfterWave = 0;
  for (const line of requestedLines) {
    const inc = incrementByItemId.get(line.id) ?? 0;
    fulfilledAfterWave += line.fulfilledQty + inc;
  }
  const nextStatus = fulfilledAfterWave < totalRequested ? "FULFILLED_PARTIAL" : "DISPATCHED";
  await prisma.stockRequest.update({
    where: { id: requestId },
    data: { status: nextStatus },
  });

  return transfersService.getTransferById(transferId);
}

/**
 * Preview FEFO allocation without executing dispatch.
 * Returns allocation preview with lot details and warnings.
 */
export async function allocationPreview(requestId: number, input: {
  fromLocationId: number;
  items: Array<{ stockRequestItemId: number; fulfillQty: number }>;
}) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");

  await assertSourceLocationMatchesRequestOrg(input.fromLocationId, request.orgId);

  const allocations: Array<{
    stockRequestItemId: number;
    variantId: number;
    fulfillQty: number;
    lots: Array<{ lotId: number; lotCode: string; quantity: number; expDate: Date; mfgDate: Date }>;
    warnings: Array<{ code: string; message: string }>;
  }> = [];

  for (const item of input.items) {
    const row = request.items.find((i) => i.id === item.stockRequestItemId);
    if (!row) {
      throw new Error(`Stock request item ${item.stockRequestItemId} not found`);
    }

    const warnings: Array<{ code: string; message: string }> = [];
    const lots: Array<{ lotId: number; lotCode: string; quantity: number; expDate: Date; mfgDate: Date }> = [];

    try {
      const slices = await allocateVariantFifo(
        request.orgId,
        input.fromLocationId,
        row.variantId,
        item.fulfillQty
      );

      if (slices.length > 1) {
        warnings.push({
          code: "MULTI_LOT_SPLIT",
          message: `Quantity split across ${slices.length} lots`,
        });
      }

      for (const slice of slices) {
        const lot = await prisma.stockLot.findUnique({
          where: { id: slice.lotId },
          select: { id: true, lotCode: true, expDate: true, mfgDate: true },
        });
        if (lot) {
          lots.push({
            lotId: lot.id,
            lotCode: lot.lotCode,
            quantity: slice.quantity,
            expDate: lot.expDate,
            mfgDate: lot.mfgDate,
          });

          // Check for near expiry
          const now = new Date();
          const nearExpiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          if (lot.expDate <= nearExpiryDate && lot.expDate > now) {
            const daysLeft = Math.ceil((lot.expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            warnings.push({
              code: "NEAR_EXPIRY",
              message: `Lot ${lot.lotCode} expires in ${daysLeft} days`,
            });
          }
        }
      }
    } catch (e: any) {
      // FEFO failed, check if aggregate can cover
      const bal = await prisma.stockBalance.findUnique({
        where: {
          locationId_variantId: { locationId: input.fromLocationId, variantId: row.variantId },
        },
      });
      const aggregate = Math.max(0, (bal?.onHandQty ?? 0) - (bal?.reservedQty ?? 0));
      if (aggregate >= item.fulfillQty) {
        warnings.push({
          code: "NON_LOT_DISPATCH",
          message: `Will dispatch from aggregate stock (no lot tracking)`,
        });
      } else {
        warnings.push({
          code: "INSUFFICIENT_STOCK",
          message: e?.message || "Insufficient stock for FEFO allocation",
        });
      }
    }

    allocations.push({
      stockRequestItemId: item.stockRequestItemId,
      variantId: row.variantId,
      fulfillQty: item.fulfillQty,
      lots,
      warnings,
    });
  }

  return { allocations };
}

/**
 * Cancel a specific line (full or partial qty).
 * Sets cancelledQty on the line. Remaining = requested - fulfilled - cancelled.
 */
export async function cancelLine(
  requestId: number,
  itemId: number,
  data: { cancelledQty: number; reason?: string; cancelledByUserId?: number }
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");

  // Allow cancellation in SUBMITTED, OWNER_REVIEW, or FULFILLED_PARTIAL states
  if (!["SUBMITTED", "OWNER_REVIEW", "FULFILLED_PARTIAL"].includes(request.status)) {
    throw new Error(`Cannot cancel lines when request status is ${request.status}`);
  }

  const item = request.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Stock request item not found");

  const maxCancellable = item.requestedQty - item.fulfilledQty;
  if (data.cancelledQty < 0 || data.cancelledQty > maxCancellable) {
    throw new Error(
      `Invalid cancelledQty: ${data.cancelledQty}. Must be between 0 and ${maxCancellable} (requested ${item.requestedQty}, fulfilled ${item.fulfilledQty})`
    );
  }

  const updated = await prisma.stockRequestItem.update({
    where: { id: itemId },
    data: {
      cancelledQty: data.cancelledQty,
      cancelReason: data.reason ?? null,
      cancelledAt: data.cancelledQty > 0 ? new Date() : null,
      cancelledByUserId: data.cancelledQty > 0 ? data.cancelledByUserId ?? null : null,
    },
    include: {
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
      cancelledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });

  return updated;
}

/**
 * Restore a cancelled line (sets cancelledQty = 0).
 * Only allowed when request is still in dispatchable state.
 */
export async function restoreLine(requestId: number, itemId: number) {
  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    include: { items: true },
  });
  if (!request) throw new Error("Stock request not found");

  // Allow restore in SUBMITTED, OWNER_REVIEW, or FULFILLED_PARTIAL states
  if (!["SUBMITTED", "OWNER_REVIEW", "FULFILLED_PARTIAL"].includes(request.status)) {
    throw new Error(`Cannot restore lines when request status is ${request.status}`);
  }

  const item = request.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Stock request item not found");

  if (item.cancelledQty === 0) {
    throw new Error("Line is not cancelled");
  }

  const updated = await prisma.stockRequestItem.update({
    where: { id: itemId },
    data: {
      cancelledQty: 0,
      cancelReason: null,
      cancelledAt: null,
      cancelledByUserId: null,
    },
    include: {
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
    },
  });

  return updated;
}

module.exports = {
  createRequest,
  listRequests,
  getRequestById,
  updateRequestItems,
  submitRequest,
  cancelRequest,
  approveRequest,
  declineRequest,
  fulfillAndDispatch,
  fulfillStockRequestFlexible,
  markRequestReceivedIfLinked,
  markStockRequestStatusFromDispatchReceive,
  cancelLine,
  restoreLine,
  allocationPreview,
};
