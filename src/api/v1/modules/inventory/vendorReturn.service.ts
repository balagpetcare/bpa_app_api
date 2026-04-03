import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * Create a vendor return (draft state)
 */
export async function createVendorReturn(data: {
  orgId: number;
  vendorId: number;
  locationId: number;
  reason: string;
  note?: string;
  creditExpected?: number;
  referenceNumber?: string;
  lines: Array<{
    variantId: number;
    lotId?: number;
    quantity: number;
    unitCost?: number;
    condition?: string;
    note?: string;
  }>;
  createdByUserId: number;
}) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: data.vendorId },
    select: { id: true, name: true, orgId: true },
  });
  if (!vendor || vendor.orgId !== data.orgId) throw new Error("Vendor not found or does not belong to org");

  const location = await prisma.inventoryLocation.findUnique({
    where: { id: data.locationId },
    include: { branch: { select: { orgId: true } } },
  });
  if (!location || location.branch.orgId !== data.orgId) {
    throw new Error("Location not found or does not belong to org");
  }

  return prisma.vendorReturn.create({
    data: {
      orgId: data.orgId,
      vendorId: data.vendorId,
      locationId: data.locationId,
      reason: data.reason,
      note: data.note,
      creditExpected: data.creditExpected ?? null,
      referenceNumber: data.referenceNumber ?? null,
      createdByUserId: data.createdByUserId,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          lotId: l.lotId ?? null,
          quantity: l.quantity,
          unitCost: l.unitCost ?? null,
          condition: l.condition ?? "RESELLABLE",
          note: l.note ?? null,
        })),
      },
    },
    include: _includeDetail,
  });
}

/**
 * List vendor returns
 */
export async function listVendorReturns(opts: {
  orgId?: number;
  vendorId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const where: any = {};
  if (opts.orgId) where.orgId = opts.orgId;
  if (opts.vendorId) where.vendorId = opts.vendorId;
  if (opts.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.vendorReturn.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: _includeList,
    }),
    prisma.vendorReturn.count({ where }),
  ]);

  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Get single vendor return
 */
export async function getVendorReturn(id: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, include: _includeDetail });
  if (!r) throw new Error("Vendor return not found");
  return r;
}

/**
 * Submit (DRAFT → SUBMITTED)
 */
export async function submitVendorReturn(id: number, userId: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Vendor return not found");
  if (r.status !== "DRAFT") throw new Error(`Cannot submit from status ${r.status}`);
  return prisma.vendorReturn.update({
    where: { id },
    data: { status: "SUBMITTED" },
    include: _includeDetail,
  });
}

/**
 * Approve (SUBMITTED → APPROVED) — posts RETURN_OUT ledger entries to deduct stock
 */
export async function approveVendorReturn(id: number, approvedByUserId: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!r) throw new Error("Vendor return not found");
  if (r.status !== "SUBMITTED") throw new Error(`Cannot approve from status ${r.status}`);

  return prisma.$transaction(async (tx) => {
    for (const line of r.lines) {
      const ledger = await tx.stockLedger.create({
        data: {
          orgId: r.orgId,
          locationId: r.locationId,
          variantId: line.variantId,
          lotId: line.lotId,
          type: "RETURN_OUT",
          quantityDelta: -line.quantity,
          unitCost: line.unitCost,
          refType: "VENDOR_RETURN",
          refId: String(r.id),
          createdByUserId: approvedByUserId,
        },
      });

      // Deduct stock lot balance
      if (line.lotId) {
        await tx.stockLotBalance.updateMany({
          where: { locationId: r.locationId, lotId: line.lotId },
          data: { onHandQty: { decrement: line.quantity } },
        });
      }

      // Deduct aggregate balance
      await tx.stockBalance.updateMany({
        where: { locationId: r.locationId, variantId: line.variantId },
        data: { onHandQty: { decrement: line.quantity } },
      });

      await tx.vendorReturnLine.update({
        where: { id: line.id },
        data: { ledgerId: ledger.id },
      });
    }

    return tx.vendorReturn.update({
      where: { id },
      data: { status: "APPROVED", approvedByUserId, approvedAt: new Date() },
      include: _includeDetail,
    });
  });
}

/**
 * Mark dispatched (APPROVED → DISPATCHED)
 */
export async function dispatchVendorReturn(id: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Vendor return not found");
  if (r.status !== "APPROVED") throw new Error(`Cannot dispatch from status ${r.status}`);
  return prisma.vendorReturn.update({
    where: { id },
    data: { status: "DISPATCHED", dispatchedAt: new Date() },
    include: _includeDetail,
  });
}

/**
 * Mark received by vendor (DISPATCHED → RECEIVED_BY_VENDOR)
 */
export async function markReceivedByVendor(id: number, referenceNumber?: string) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Vendor return not found");
  if (r.status !== "DISPATCHED") throw new Error(`Cannot mark received from status ${r.status}`);
  return prisma.vendorReturn.update({
    where: { id },
    data: {
      status: "RECEIVED_BY_VENDOR",
      receivedByVendorAt: new Date(),
      ...(referenceNumber ? { referenceNumber } : {}),
    },
    include: _includeDetail,
  });
}

/**
 * Mark credited (RECEIVED_BY_VENDOR → CREDITED) — records vendor ledger credit
 */
export async function markCredited(id: number, creditReceived: number, userId: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, select: { status: true, vendorId: true, orgId: true } });
  if (!r) throw new Error("Vendor return not found");
  if (r.status !== "RECEIVED_BY_VENDOR") throw new Error(`Cannot credit from status ${r.status}`);

  return prisma.$transaction(async (tx) => {
    // Create vendor ledger credit entry
    await tx.vendorLedgerEntry.create({
      data: {
        vendorId: r.vendorId,
        orgId: r.orgId,
        sourceType: "RETURN",
        sourceId: String(id),
        credit: creditReceived,
        debit: 0,
      },
    });

    return tx.vendorReturn.update({
      where: { id },
      data: { status: "CREDITED", creditReceived, creditedAt: new Date() },
      include: _includeDetail,
    });
  });
}

/**
 * Cancel (DRAFT or SUBMITTED → CANCELLED) - reverses ledger if already approved
 */
export async function cancelVendorReturn(id: number, userId: number) {
  const r = await prisma.vendorReturn.findUnique({ where: { id }, select: { status: true } });
  if (!r) throw new Error("Vendor return not found");
  if (!["DRAFT", "SUBMITTED"].includes(r.status)) {
    throw new Error(`Cannot cancel a return in status ${r.status}`);
  }
  return prisma.vendorReturn.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    include: _includeDetail,
  });
}

// ---- includes ----
const _includeList = {
  vendor: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
  _count: { select: { lines: true } },
} as const;

const _includeDetail = {
  vendor: { select: { id: true, name: true, contactEmail: true, contactPhone: true } },
  location: { select: { id: true, name: true, type: true, branch: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
  approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  lines: {
    include: {
      variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
      lot: { select: { id: true, lotCode: true, expDate: true } },
      ledger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
    },
  },
} as const;
