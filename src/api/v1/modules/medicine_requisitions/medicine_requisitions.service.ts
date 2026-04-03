import prisma from "../../../../infrastructure/db/prismaClient";
import { MedicineRequisitionStatus, MedicineRequisitionUrgency } from "@prisma/client";
const ledgerService = require("../inventory/ledger.service");

const ALLOWED_STATUSES = new Set<string>(Object.values(MedicineRequisitionStatus));
const ALLOWED_URGENCIES = new Set<string>(Object.values(MedicineRequisitionUrgency));

/** Drops unknown status tokens (bad URLs); empty => no status filter. */
function normalizeStatusFilterInput(status?: string): string | undefined {
  if (!status?.trim()) return undefined;
  const parts = status
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = parts.filter((p) => ALLOWED_STATUSES.has(p));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return valid.join(",");
}

function normalizeUrgencyFilterInput(urgency?: string): string | undefined {
  if (!urgency?.trim()) return undefined;
  return ALLOWED_URGENCIES.has(urgency) ? urgency : undefined;
}

// ─── Types ───────────────────────────────────────────────────────────────

export type CreateRequisitionInput = {
  orgId: number;
  branchId: number;
  requestedByUserId: number;
  urgency?: "NORMAL" | "URGENT" | "CRITICAL";
  note?: string;
  items: Array<{
    medicineListingId: number;
    requestedQty: number;
    unit?: string;
    note?: string;
    allowSubstitute?: boolean;
  }>;
};

export type ListRequisitionsFilter = {
  branchIds?: number[];
  status?: string;
  urgency?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

/** Inclusive UTC day boundaries for YYYY-MM-DD filter inputs (timezone-safe server-side). */
function startOfUtcDay(isoDate: string): Date {
  return new Date(`${isoDate.trim()}T00:00:00.000Z`);
}

function endOfUtcDayInclusive(isoDate: string): Date {
  return new Date(`${isoDate.trim()}T23:59:59.999Z`);
}

export type ApproveRequisitionInput = {
  approvedByUserId: number;
  reviewNote?: string;
  items: Array<{
    itemId: number;
    approvedQty: number;
    substitutedListingId?: number;
    substitutionReason?: string;
  }>;
};

export type DispatchRequisitionInput = {
  fromLocationId: number;
  toLocationId: number;
  items: Array<{ variantId: number; lotId: number; quantity: number }>;
  createdByUserId: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateRequisitionNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MR-${ts}-${rand}`;
}

function addTimeline(
  tx: any,
  requisitionId: number,
  action: string,
  performedByUserId: number | null,
  note?: string | null,
  meta?: any
) {
  return tx.medicineRequisitionTimeline.create({
    data: {
      requisitionId,
      action,
      performedByUserId: performedByUserId ?? undefined,
      note: note ?? undefined,
      meta: meta ?? undefined,
    },
  });
}

const REQUISITION_INCLUDE = {
  branch: { select: { id: true, name: true, orgId: true } },
  requestedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  reviewedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  approvedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  rejectedBy: {
    select: { id: true, profile: { select: { displayName: true } } },
  },
  items: {
    include: {
      medicineListing: {
        select: {
          id: true,
          packageMarkDisplay: true,
          presentation: {
            select: {
              id: true,
              strengthDisplay: true,
              generic: { select: { id: true, displayName: true } },
              dosageForm: { select: { id: true, displayName: true } },
            },
          },
          brand: {
            select: {
              id: true,
              displayName: true,
              manufacturer: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      substitutedListing: {
        select: {
          id: true,
          packageMarkDisplay: true,
          brand: { select: { id: true, displayName: true } },
        },
      },
      product: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true } },
    },
  },
  timeline: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
    include: {
      performedBy: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
    },
  },
};

// ─── Service Functions ───────────────────────────────────────────────────

/**
 * Create a DRAFT medicine requisition from a branch.
 */
async function createRequisition(data: CreateRequisitionInput) {
  if (!data.items?.length) {
    throw new Error("At least one item is required");
  }
  for (const item of data.items) {
    if (!item.medicineListingId || !item.requestedQty || item.requestedQty <= 0) {
      throw new Error("Each item must have medicineListingId and positive requestedQty");
    }
  }

  // Resolve product/variant for each listing via the strict 1:1 mapping
  const listingIds = data.items.map((i) => i.medicineListingId);
  const products = await prisma.product.findMany({
    where: {
      medicineListingId: { in: listingIds },
      orgId: data.orgId,
      isMedicine: true,
    },
    select: {
      id: true,
      medicineListingId: true,
      variants: {
        where: { isActive: true },
        take: 1,
        select: { id: true },
      },
    },
  });
  const productByListing = new Map(
    products.map((p) => [p.medicineListingId!, p])
  );

  return prisma.$transaction(async (tx) => {
    const requisition = await tx.medicineRequisition.create({
      data: {
        requisitionNumber: generateRequisitionNumber(),
        orgId: data.orgId,
        branchId: data.branchId,
        requestedByUserId: data.requestedByUserId,
        urgency: data.urgency ?? "NORMAL",
        status: "DRAFT",
        note: data.note ?? null,
        items: {
          create: data.items.map((i) => {
            const prod = productByListing.get(i.medicineListingId);
            return {
              medicineListingId: i.medicineListingId,
              productId: prod?.id ?? null,
              variantId: prod?.variants?.[0]?.id ?? null,
              requestedQty: i.requestedQty,
              unit: i.unit ?? null,
              note: i.note ?? null,
              allowSubstitute: i.allowSubstitute ?? false,
            };
          }),
        },
      },
      include: REQUISITION_INCLUDE,
    });

    await addTimeline(tx, requisition.id, "CREATED", data.requestedByUserId);
    return requisition;
  });
}

/**
 * List requisitions with pagination + filters.
 * Requires non-empty branchIds (caller scopes to visible branches); otherwise returns empty.
 */
async function listRequisitions(filter: ListRequisitionsFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  if (!filter.branchIds?.length) {
    return {
      items: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  const where: any = {
    branchId: { in: filter.branchIds },
  };
  const statusNorm = normalizeStatusFilterInput(filter.status);
  if (statusNorm) {
    const parts = statusNorm
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      where.status = { in: parts };
    } else {
      where.status = parts[0];
    }
  }
  const urgencyNorm = normalizeUrgencyFilterInput(filter.urgency);
  if (urgencyNorm) where.urgency = urgencyNorm;
  if (filter.dateFrom || filter.dateTo) {
    where.createdAt = {};
    if (filter.dateFrom) where.createdAt.gte = startOfUtcDay(filter.dateFrom);
    if (filter.dateTo) where.createdAt.lte = endOfUtcDayInclusive(filter.dateTo);
  }

  const [items, total] = await Promise.all([
    prisma.medicineRequisition.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        requestedBy: {
          select: {
            id: true,
            profile: { select: { displayName: true } },
          },
        },
        items: {
          select: {
            id: true,
            requestedQty: true,
            approvedQty: true,
            receivedQty: true,
            medicineListing: {
              select: {
                id: true,
                packageMarkDisplay: true,
                brand: { select: { displayName: true } },
                presentation: {
                  select: {
                    generic: { select: { displayName: true } },
                    dosageForm: { select: { displayName: true } },
                    strengthDisplay: true,
                  },
                },
              },
            },
          },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.medicineRequisition.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}

/**
 * Dashboard counts — same branch scope as list (no status/urgency/date filters).
 */
async function getRequisitionDashboardSummary(branchIds: number[]) {
  if (!branchIds.length) {
    return {
      total: 0,
      pending: 0,
      approved: 0,
      dispatched: 0,
    };
  }
  const base: { branchId: { in: number[] } } = { branchId: { in: branchIds } };
  const [total, pending, approved, dispatched] = await Promise.all([
    prisma.medicineRequisition.count({ where: base }),
    prisma.medicineRequisition.count({
      where: {
        ...base,
        status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
      },
    }),
    prisma.medicineRequisition.count({
      where: {
        ...base,
        status: { in: ["APPROVED", "PARTIALLY_APPROVED", "READY_TO_DISPATCH"] },
      },
    }),
    prisma.medicineRequisition.count({
      where: {
        ...base,
        status: { in: ["DISPATCHED", "IN_TRANSIT"] },
      },
    }),
  ]);
  return { total, pending, approved, dispatched };
}

/**
 * Get a single requisition by ID with full details.
 */
async function getRequisitionById(id: number) {
  return prisma.medicineRequisition.findUnique({
    where: { id },
    include: REQUISITION_INCLUDE,
  });
}

/**
 * Update items on a DRAFT requisition.
 */
async function updateRequisitionItems(
  id: number,
  items: Array<{
    medicineListingId: number;
    requestedQty: number;
    unit?: string;
    note?: string;
    allowSubstitute?: boolean;
  }>,
  orgId: number
) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true, orgId: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (existing.status !== "DRAFT") {
    throw new Error("Can only update items on DRAFT requisitions");
  }

  const listingIds = items.map((i) => i.medicineListingId);
  const products = await prisma.product.findMany({
    where: {
      medicineListingId: { in: listingIds },
      orgId,
      isMedicine: true,
    },
    select: {
      id: true,
      medicineListingId: true,
      variants: { where: { isActive: true }, take: 1, select: { id: true } },
    },
  });
  const productByListing = new Map(
    products.map((p) => [p.medicineListingId!, p])
  );

  return prisma.$transaction(async (tx) => {
    await tx.medicineRequisitionItem.deleteMany({
      where: { requisitionId: id },
    });
    return tx.medicineRequisition.update({
      where: { id },
      data: {
        items: {
          create: items.map((i) => {
            const prod = productByListing.get(i.medicineListingId);
            return {
              medicineListingId: i.medicineListingId,
              productId: prod?.id ?? null,
              variantId: prod?.variants?.[0]?.id ?? null,
              requestedQty: i.requestedQty,
              unit: i.unit ?? null,
              note: i.note ?? null,
              allowSubstitute: i.allowSubstitute ?? false,
            };
          }),
        },
      },
      include: REQUISITION_INCLUDE,
    });
  });
}

/**
 * Submit a DRAFT requisition for review.
 */
async function submitRequisition(id: number, userId: number) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (existing.status !== "DRAFT") {
    throw new Error("Can only submit DRAFT requisitions");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
      include: REQUISITION_INCLUDE,
    });
    await addTimeline(tx, id, "SUBMITTED", userId);
    return updated;
  });
}

/**
 * Owner: approve (full or partial) with optional substitutions.
 */
async function approveRequisition(id: number, input: ApproveRequisitionInput) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(existing.status)) {
    throw new Error("Can only approve SUBMITTED or UNDER_REVIEW requisitions");
  }

  return prisma.$transaction(async (tx) => {
    // Update each item with approved qty + optional substitute
    for (const item of input.items) {
      const data: any = { approvedQty: item.approvedQty };
      if (item.substitutedListingId) {
        data.substitutedListingId = item.substitutedListingId;
        data.substitutionReason = item.substitutionReason ?? null;
      }
      await tx.medicineRequisitionItem.update({
        where: { id: item.itemId },
        data,
      });
    }

    // Check if any items were partially approved
    const allItems = await tx.medicineRequisitionItem.findMany({
      where: { requisitionId: id },
      select: { requestedQty: true, approvedQty: true },
    });
    const isPartial = allItems.some(
      (i) => i.approvedQty !== null && i.approvedQty < i.requestedQty
    );
    const newStatus = isPartial ? "PARTIALLY_APPROVED" : "APPROVED";

    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: {
        status: newStatus,
        approvedByUserId: input.approvedByUserId,
        approvedAt: new Date(),
        reviewedByUserId: input.approvedByUserId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
      },
      include: REQUISITION_INCLUDE,
    });

    await addTimeline(tx, id, newStatus, input.approvedByUserId, input.reviewNote);
    return updated;
  });
}

/**
 * Owner: reject requisition with reason.
 */
async function rejectRequisition(
  id: number,
  rejectedByUserId: number,
  reason?: string
) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(existing.status)) {
    throw new Error("Can only reject SUBMITTED or UNDER_REVIEW requisitions");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectedByUserId,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null,
        reviewedByUserId: rejectedByUserId,
        reviewedAt: new Date(),
      },
      include: REQUISITION_INCLUDE,
    });
    await addTimeline(tx, id, "REJECTED", rejectedByUserId, reason);
    return updated;
  });
}

/**
 * Owner: dispatch approved requisition using existing transfer + dispatch infrastructure.
 * Reuses StockTransfer + StockDispatch + FEFO lot selection via ledger.service.
 */
async function dispatchRequisition(
  id: number,
  input: DispatchRequisitionInput
) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true, orgId: true, branchId: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (!["APPROVED", "PARTIALLY_APPROVED", "READY_TO_DISPATCH"].includes(existing.status)) {
    throw new Error("Requisition must be APPROVED or READY_TO_DISPATCH to dispatch");
  }

  return prisma.$transaction(async (tx) => {
    // 1. Create StockTransfer (reusing existing logic)
    const transfer = await tx.stockTransfer.create({
      data: {
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        status: "SENT",
        createdByUserId: input.createdByUserId,
        sentAt: new Date(),
        items: {
          create: input.items.map((i) => ({
            variantId: i.variantId,
            lotId: i.lotId,
            quantitySent: i.quantity,
          })),
        },
      },
    });

    // 2. Create StockDispatch (reusing existing model, stockRequestId is nullable now)
    const dispatch = await tx.stockDispatch.create({
      data: {
        orgId: existing.orgId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        status: "CREATED",
        createdByUserId: input.createdByUserId,
        items: {
          create: input.items.map((i) => ({
            variantId: i.variantId,
            lotId: i.lotId,
            quantityDispatched: i.quantity,
          })),
        },
      },
    });

    // 3. Write TRANSFER_OUT ledger entries for each item at the from-location
    for (const item of input.items) {
      await tx.stockLedger.create({
        data: {
          orgId: existing.orgId,
          locationId: input.fromLocationId,
          variantId: item.variantId,
          lotId: item.lotId,
          type: "TRANSFER_OUT",
          quantityDelta: -item.quantity,
          refType: "STOCK_TRANSFER",
          refId: String(transfer.id),
          createdByUserId: input.createdByUserId,
        },
      });
    }

    // 4. Update requisition status + link transfer/dispatch
    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: {
        status: "DISPATCHED",
        stockTransferId: transfer.id,
        stockDispatchId: dispatch.id,
      },
      include: REQUISITION_INCLUDE,
    });

    await addTimeline(tx, id, "DISPATCHED", input.createdByUserId, null, {
      stockTransferId: transfer.id,
      stockDispatchId: dispatch.id,
    });

    return updated;
  });
}

/**
 * ENHANCED: Auto-dispatch requisition with FEFO batch allocation
 * Reads requisition items, auto-allocates batches using FEFO, then dispatches
 */
async function dispatchRequisitionWithFEFO(params: {
  requisitionId: number;
  fromLocationId: number;
  toLocationId: number;
  userId: number;
}) {
  const requisition = await prisma.medicineRequisition.findUnique({
    where: { id: params.requisitionId },
    include: {
      items: {
        select: {
          id: true,
          variantId: true,
          approvedQty: true,
          requestedQty: true,
        },
      },
    },
  });

  if (!requisition) {
    throw new Error("Requisition not found");
  }

  if (!["APPROVED", "PARTIALLY_APPROVED", "READY_TO_DISPATCH"].includes(requisition.status)) {
    throw new Error("Requisition must be APPROVED or READY_TO_DISPATCH to dispatch");
  }

  // Auto-allocate batches using FEFO for each item
  const dispatchItems: Array<{ variantId: number; lotId: number; quantity: number }> = [];

  for (const reqItem of requisition.items) {
    if (!reqItem.variantId) {
      throw new Error(`Requisition item ${reqItem.id} has no mapped variant`);
    }

    const qtyToDispatch = reqItem.approvedQty ?? reqItem.requestedQty;
    if (qtyToDispatch <= 0) continue;

    // Get available lots using FEFO (sorted by earliest expiry)
    const availableLots = await ledgerService.getAvailableLotsFEFO(
      params.fromLocationId,
      reqItem.variantId
    );

    let remaining = qtyToDispatch;
    for (const lot of availableLots) {
      if (remaining <= 0) break;

      const allocate = Math.min(remaining, lot.availableQty);
      if (allocate <= 0) continue;

      dispatchItems.push({
        variantId: reqItem.variantId,
        lotId: lot.lotId,
        quantity: allocate,
      });

      remaining -= allocate;
    }

    if (remaining > 0) {
      throw new Error(
        `Insufficient stock for variant ${reqItem.variantId}. Requested: ${qtyToDispatch}, Available: ${qtyToDispatch - remaining}`
      );
    }
  }

  // Use existing dispatch function with FEFO-allocated items
  return dispatchRequisition(params.requisitionId, {
    fromLocationId: params.fromLocationId,
    toLocationId: params.toLocationId,
    items: dispatchItems,
    createdByUserId: params.userId,
  });
}

/**
 * Branch: receive dispatched goods. Marks received quantities on items.
 */
async function receiveRequisition(
  id: number,
  receivedByUserId: number,
  items: Array<{ itemId: number; receivedQty: number }>
) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: {
      status: true,
      orgId: true,
      branchId: true,
      stockTransferId: true,
      stockDispatchId: true,
    },
  });
  if (!existing) throw new Error("Requisition not found");
  if (!["DISPATCHED", "IN_TRANSIT"].includes(existing.status)) {
    throw new Error("Can only receive DISPATCHED or IN_TRANSIT requisitions");
  }

  return prisma.$transaction(async (tx) => {
    // Update each item with received quantity
    for (const item of items) {
      await tx.medicineRequisitionItem.update({
        where: { id: item.itemId },
        data: { receivedQty: item.receivedQty },
      });
    }

    // Determine if fully or partially received
    const allItems = await tx.medicineRequisitionItem.findMany({
      where: { requisitionId: id },
      select: { approvedQty: true, dispensedQty: true, receivedQty: true },
    });
    const isPartial = allItems.some(
      (i) =>
        i.receivedQty !== null &&
        i.receivedQty < (i.dispensedQty ?? i.approvedQty ?? 0)
    );
    const newStatus = isPartial ? "PARTIALLY_RECEIVED" : "RECEIVED";

    // If there's a linked transfer, mark received on transfer items too
    if (existing.stockTransferId) {
      const transferItems = await tx.stockTransferItem.findMany({
        where: { transferId: existing.stockTransferId },
      });
      // Get the to-location from transfer
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: existing.stockTransferId },
        select: { toLocationId: true },
      });

      for (const ti of transferItems) {
        const matchingItem = items.find((i) => {
          // Match by looking up the requisition item's variant
          return true; // simplified — all transfer items get marked received
        });
        await tx.stockTransferItem.update({
          where: { id: ti.id },
          data: { quantityReceived: ti.quantitySent },
        });

        // Write TRANSFER_IN ledger entry at receiving location
        if (transfer) {
          await tx.stockLedger.create({
            data: {
              orgId: existing.orgId,
              locationId: transfer.toLocationId,
              variantId: ti.variantId,
              lotId: ti.lotId,
              type: "TRANSFER_IN",
              quantityDelta: ti.quantitySent,
              refType: "STOCK_TRANSFER",
              refId: String(existing.stockTransferId!),
              createdByUserId: receivedByUserId,
            },
          });
        }
      }

      // Mark transfer as received
      await tx.stockTransfer.update({
        where: { id: existing.stockTransferId },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });
    }

    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: {
        status: newStatus,
        completedAt: newStatus === "RECEIVED" ? new Date() : undefined,
      },
      include: REQUISITION_INCLUDE,
    });

    await addTimeline(tx, id, newStatus, receivedByUserId);
    return updated;
  });
}

/**
 * Cancel a requisition (DRAFT or SUBMITTED only).
 */
async function cancelRequisition(
  id: number,
  cancelledByUserId: number,
  reason?: string
) {
  const existing = await prisma.medicineRequisition.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw new Error("Requisition not found");
  if (!["DRAFT", "SUBMITTED"].includes(existing.status)) {
    throw new Error("Can only cancel DRAFT or SUBMITTED requisitions");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.medicineRequisition.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledByUserId,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
      },
      include: REQUISITION_INCLUDE,
    });
    await addTimeline(tx, id, "CANCELLED", cancelledByUserId, reason);
    return updated;
  });
}

// ─── Medicine Search ────────────────────────────────────────────────────

const REQUISITION_UNIT_OPTIONS = [
  "pcs",
  "strip",
  "box",
  "bottle",
  "vial",
  "ampoule",
  "sachet",
  "tube",
  "pack",
  "ml",
] as const;

function normalizeSearchToken(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whitespace-aware: multi-word queries AND-match tokens across searchable fields. */
function tokenizeMedicineQuery(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const p = parts[0];
    return p.length >= 2 ? [p] : [];
  }
  return parts.filter((p) => p.length >= 1);
}

function orClauseForToken(token: string): { OR: any[] } {
  const t = token.trim();
  const norm = normalizeSearchToken(t);
  const or: any[] = [
    { packageMarkDisplay: { contains: t, mode: "insensitive" } },
    { brand: { displayName: { contains: t, mode: "insensitive" } } },
    { presentation: { generic: { displayName: { contains: t, mode: "insensitive" } } } },
    { presentation: { strengthDisplay: { contains: t, mode: "insensitive" } } },
    { presentation: { dosageForm: { displayName: { contains: t, mode: "insensitive" } } } },
    { brand: { manufacturer: { displayName: { contains: t, mode: "insensitive" } } } },
  ];
  if (norm.length >= 2) {
    or.push(
      { packageMarkNormalized: { contains: norm, mode: "insensitive" } },
      { brand: { normalizedKey: { contains: norm, mode: "insensitive" } } },
      { presentation: { strengthNormalizedKey: { contains: norm, mode: "insensitive" } } }
    );
  }
  return { OR: or };
}

function inferSuggestedUnit(dosageFormName?: string | null): string {
  if (!dosageFormName) return "pcs";
  const d = dosageFormName.toLowerCase();
  if (/\b(tablet|tab|capsule|cap|pill)\b/.test(d)) return "strip";
  if (/\b(syrup|suspension|solution|elixir|drops?|mixture)\b/.test(d)) return "bottle";
  if (/\b(powder\s+for|dry\s+syrup|granules)\b/.test(d)) return "bottle";
  if (/\b(injection|injectable|infusion)\b/.test(d)) return "vial";
  if (/\b(ampoule|ampule)\b/.test(d)) return "ampoule";
  if (/\b(cream|ointment|gel|lotion|topical)\b/.test(d)) return "tube";
  if (/\bsachet\b/.test(d)) return "sachet";
  if (/\bvial\b/.test(d)) return "vial";
  if (/\b(spray|inhaler|nasal)\b/.test(d)) return "pack";
  if (/\b(ml|liquid)\b/.test(d) && /\b(oral|solution)\b/.test(d)) return "bottle";
  return "pcs";
}

function listingSearchBlob(l: any): string {
  const parts = [
    l.packageMarkDisplay,
    l.packageMarkNormalized,
    l.brand?.displayName,
    l.brand?.normalizedKey,
    l.presentation?.generic?.displayName,
    l.presentation?.strengthDisplay,
    l.presentation?.strengthNormalizedKey,
    l.presentation?.dosageForm?.displayName,
    l.brand?.manufacturer?.displayName,
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function scoreListing(l: any, rawQ: string, tokens: string[]): number {
  const qLower = rawQ.trim().toLowerCase();
  const blob = listingSearchBlob(l);
  const normBlob = normalizeSearchToken(blob);
  const brand = (l.brand?.displayName || "").toLowerCase();
  const pkg = (l.packageMarkDisplay || "").toLowerCase();
  let score = 0;
  if (qLower.length >= 2) {
    if (brand === qLower) score += 500;
    else if (brand.startsWith(qLower)) score += 220;
    else if (pkg.startsWith(qLower)) score += 180;
    else if (blob.includes(qLower)) score += 80;
    const qn = normalizeSearchToken(rawQ);
    if (qn.length >= 2 && normBlob.includes(qn)) score += 100;
  }
  for (const tok of tokens) {
    const tl = tok.toLowerCase();
    if (brand.startsWith(tl)) score += 60;
    else if (brand.includes(tl)) score += 35;
    else if (pkg.includes(tl)) score += 30;
    else if (blob.includes(tl)) score += 18;
    const tn = normalizeSearchToken(tok);
    if (tn.length >= 2 && normBlob.includes(tn)) score += 25;
  }
  return score;
}

async function searchMedicine(params: {
  q?: string;
  countryId?: number;
  branchId?: number;
  orgId?: number;
  limit?: number;
}) {
  const { q, countryId, branchId, limit = 20 } = params;
  // Allow up to 100 ranked hits for high-volume pharmacy search (UI scroll + multi-select).
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const fetchCap = Math.min(cap * 5, 400);

  let resolvedCountryId = countryId;
  if (!resolvedCountryId && branchId) {
    const b = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { org: { select: { countryId: true } } },
    });
    resolvedCountryId = b?.org?.countryId ?? undefined;
  }

  const base: any[] = [{ isActive: true }];
  if (resolvedCountryId) base.push({ countryId: resolvedCountryId });

  const tokens = q ? tokenizeMedicineQuery(q) : [];
  if (!tokens.length) {
    return [];
  }

  const rawQ = q!.trim();
  let where: any = { AND: [...base] };

  if (tokens.length === 1) {
    where.AND.push(orClauseForToken(tokens[0]));
  } else {
    where.AND.push(...tokens.map((t) => orClauseForToken(t)));
  }

  let listings = await prisma.countryMedicineBrand.findMany({
    where,
    take: fetchCap,
    orderBy: { id: "desc" },
    include: {
      presentation: {
        include: {
          generic: { select: { id: true, displayName: true } },
          dosageForm: { select: { id: true, displayName: true } },
        },
      },
      brand: {
        include: {
          manufacturer: { select: { id: true, displayName: true } },
        },
      },
      productListing: {
        select: { id: true, name: true },
      },
    },
  });

  // Relaxed fallback when strict AND returns nothing (e.g. odd spacing)
  if (listings.length === 0 && tokens.length > 1) {
    where = { AND: [...base, orClauseForToken(rawQ)] };
    listings = await prisma.countryMedicineBrand.findMany({
      where,
      take: fetchCap,
      orderBy: { id: "desc" },
      include: {
        presentation: {
          include: {
            generic: { select: { id: true, displayName: true } },
            dosageForm: { select: { id: true, displayName: true } },
          },
        },
        brand: {
          include: {
            manufacturer: { select: { id: true, displayName: true } },
          },
        },
        productListing: {
          select: { id: true, name: true },
        },
      },
    });
  }

  const seen = new Set<number>();
  const ranked = listings
    .map((l: any) => ({
      l,
      score: scoreListing(l, rawQ, tokens),
    }))
    .sort((a, b) => b.score - a.score || (a.l.packageMarkDisplay || "").localeCompare(b.l.packageMarkDisplay || ""))
    .filter(({ l }) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .slice(0, cap);

  return ranked.map(({ l }) => {
    const dosageForm = l.presentation?.dosageForm?.displayName ?? null;
    const suggestedUnit = inferSuggestedUnit(dosageForm);
    return {
      id: l.id,
      packageMarkDisplay: l.packageMarkDisplay,
      strengthDisplay: l.presentation?.strengthDisplay,
      genericName: l.presentation?.generic?.displayName,
      dosageForm,
      brandName: l.brand?.displayName,
      manufacturerName: l.brand?.manufacturer?.displayName,
      linkedProductId: l.productListing?.id ?? null,
      linkedProductName: l.productListing?.name ?? null,
      countryId: l.countryId,
      suggestedUnit: REQUISITION_UNIT_OPTIONS.includes(suggestedUnit as any) ? suggestedUnit : "pcs",
    };
  });
}

module.exports = {
  createRequisition,
  listRequisitions,
  getRequisitionDashboardSummary,
  getRequisitionById,
  updateRequisitionItems,
  submitRequisition,
  approveRequisition,
  rejectRequisition,
  dispatchRequisition,
  dispatchRequisitionWithFEFO,
  receiveRequisition,
  cancelRequisition,
  searchMedicine,
};
