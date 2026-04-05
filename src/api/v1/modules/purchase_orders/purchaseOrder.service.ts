/**
 * Purchase orders (org-scoped, vendor-linked).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { resolveWarehouseId, validateWarehouseAccess, getWarehouseInfo } from "../../utils/resolveWarehouse";

async function nextPoNumber(orgId: number, db: { purchaseOrder: { count: (args: any) => Promise<number> } } = prisma): Promise<string> {
  const count = await db.purchaseOrder.count({ where: { orgId } });
  return `PO-${orgId}-${String(count + 1).padStart(5, "0")}`;
}

export async function createPurchaseOrder(data: {
  orgId: number;
  vendorId: number;
  warehouseId?: number | null;
  purchaseRequisitionId?: number | null;
  lines: Array<{ variantId: number; orderedQty: number; unitCost?: number | null; note?: string | null }>;
  expectedDeliveryDate?: Date | null;
  notes?: string | null;
  internalNote?: string | null;
  currency?: string | null;
  createdByUserId?: number | null;
}) {
  return createPurchaseOrderWithClient(prisma, data);
}

export async function createPurchaseOrderWithClient(
  db: Prisma.TransactionClient | typeof prisma,
  data: {
    orgId: number;
    vendorId: number;
    warehouseId?: number | null;
    purchaseRequisitionId?: number | null;
    lines: Array<{ variantId: number; orderedQty: number; unitCost?: number | null; note?: string | null }>;
    expectedDeliveryDate?: Date | null;
    notes?: string | null;
    internalNote?: string | null;
    currency?: string | null;
    createdByUserId?: number | null;
  }
) {
  if (!data.lines?.length) throw new Error("At least one line is required");

  const vendor = await db.vendor.findFirst({
    where: { id: data.vendorId, orgId: data.orgId },
  });
  if (!vendor) throw new Error("Vendor not found for organization");

  // Resolve warehouse ID (handles both branch IDs and warehouse IDs)
  let resolvedWarehouseId: number | null = null;
  if (data.warehouseId != null) {
    const resolution = await resolveWarehouseId({
      orgId: data.orgId,
      warehouseId: data.warehouseId,
    }, db);

    if (!resolution.warehouseId) {
      throw new Error("Invalid warehouse or branch mapping for this organization");
    }

    resolvedWarehouseId = resolution.warehouseId;

    if (resolution.wasCreated) {
      console.log(`[PO_CREATE] Created compatibility warehouse ${resolvedWarehouseId} for branch-backed warehouse`);
    }
  }

  for (const l of data.lines) {
    const q = l.orderedQty;
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1) {
      throw new Error("Each line must have an ordered quantity of at least 1");
    }
    if (l.unitCost != null && (Number.isNaN(Number(l.unitCost)) || Number(l.unitCost) < 0)) {
      throw new Error("Line unit cost cannot be negative");
    }
  }

  const poNumber = await nextPoNumber(data.orgId, db);

  const lineTotals = data.lines.map((l) => {
    const unit = l.unitCost != null ? new Prisma.Decimal(l.unitCost) : null;
    const sub = unit ? unit.mul(l.orderedQty) : null;
    return { line: l, sub };
  });
  let subtotal: Prisma.Decimal | null = null;
  for (const { sub } of lineTotals) {
    if (sub) {
      subtotal = subtotal ? subtotal.add(sub) : sub;
    }
  }

  const createdPO = await db.purchaseOrder.create({
    data: {
      orgId: data.orgId,
      vendorId: data.vendorId,
      warehouseId: resolvedWarehouseId ?? undefined,
      purchaseRequisitionId: data.purchaseRequisitionId ?? undefined,
      poNumber,
      status: "DRAFT",
      currency: data.currency ?? undefined,
      subtotal: subtotal ?? undefined,
      grandTotal: subtotal ?? undefined,
      expectedDeliveryDate: data.expectedDeliveryDate ?? undefined,
      notes: data.notes ?? undefined,
      internalNote: data.internalNote ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          orderedQty: l.orderedQty,
          unitCost: l.unitCost != null ? l.unitCost : undefined,
          note: l.note ?? undefined,
        })),
      },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });

  // Get warehouse data for response
  const warehouseData = await getWarehouseInfo(createdPO.warehouseId, createdPO.orgId, db);

  return {
    ...createdPO,
    warehouse: warehouseData,
  };
}

export async function listPurchaseOrders(
  orgId: number,
  opts?: { status?: string; vendorId?: number; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: Prisma.PurchaseOrderWhereInput = { orgId };
  if (opts?.status) where.status = opts.status as any;
  if (opts?.vendorId) where.vendorId = opts.vendorId;

  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        lines: { select: { id: true, variantId: true, orderedQty: true, receivedQty: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  // Get warehouse data for each PO
  const itemsWithWarehouse = await Promise.all(
    items.map(async (item) => {
      const warehouseData = await getWarehouseInfo(item.warehouseId, orgId);
      return {
        ...item,
        warehouse: warehouseData,
      };
    })
  );

  return {
    items: itemsWithWarehouse,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

const actorSelect = {
  id: true,
  profile: { select: { displayName: true, username: true } },
} as const;

export async function getPurchaseOrderById(id: number, orgId: number) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, orgId },
    include: {
      vendor: { select: { id: true, name: true, phone: true, email: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
      grns: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          invoiceNo: true,
          receivedAt: true,
          locationId: true,
          _count: { select: { lines: true } },
          vendorReceiveSession: { select: { status: true, submittedAt: true } },
        },
      },
      purchaseRequisition: { select: { id: true, prNumber: true, status: true } },
      createdBy: { select: actorSelect },
      approvedBy: { select: actorSelect },
      rejectedBy: { select: actorSelect },
    },
  });

  if (!po) return null;

  // Get warehouse data for response
  const warehouseData = await getWarehouseInfo(po.warehouseId, orgId);

  return {
    ...po,
    warehouse: warehouseData,
  };
}

export async function submitPurchaseOrder(id: number, orgId: number, actorUserId?: number) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, orgId },
    include: { vendor: { select: { status: true, name: true } } },
  });
  if (!po) throw new Error("Purchase order not found");
  if (po.vendor?.status === "BLACKLISTED") {
    throw new Error("Cannot submit purchase order for a blacklisted supplier");
  }
  if (po.status !== "DRAFT") throw new Error(`Cannot submit PO in status ${po.status}`);
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
  let whId: number | null = null;
  if (po.warehouseId != null) {
    const validation = await validateWarehouseAccess({
      orgId,
      warehouseId: po.warehouseId,
    });
    whId = validation.valid ? po.warehouseId : null;
  }
  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "PO_SUBMIT",
    entityType: "PurchaseOrder",
    entityId: String(id),
    metadata: { poNumber: po.poNumber },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

export async function approvePurchaseOrder(id: number, orgId: number, approverUserId: number) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, orgId } });
  if (!po) throw new Error("Purchase order not found");
  if (!["DRAFT", "SUBMITTED"].includes(po.status)) {
    throw new Error(`Cannot approve PO in status ${po.status}`);
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByUserId: approverUserId,
    },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
  let whId: number | null = null;
  if (po.warehouseId != null) {
    const validation = await validateWarehouseAccess({
      orgId,
      warehouseId: po.warehouseId,
    });
    whId = validation.valid ? po.warehouseId : null;
  }
  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "PO_APPROVE",
    entityType: "PurchaseOrder",
    entityId: String(id),
    metadata: { poNumber: po.poNumber },
    actorUserId: approverUserId,
  });
  return updated;
}

export async function rejectPurchaseOrder(id: number, orgId: number, userId: number, reason: string) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, orgId } });
  if (!po) throw new Error("Purchase order not found");
  if (!["DRAFT", "SUBMITTED"].includes(po.status)) {
    throw new Error(`Cannot reject PO in status ${po.status}`);
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedByUserId: userId,
      rejectionReason: reason || "Rejected",
    },
    include: { vendor: { select: { id: true, name: true } }, lines: true },
  });
  let whId: number | null = null;
  if (po.warehouseId != null) {
    const validation = await validateWarehouseAccess({
      orgId,
      warehouseId: po.warehouseId,
    });
    whId = validation.valid ? po.warehouseId : null;
  }
  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "PO_REJECT",
    entityType: "PurchaseOrder",
    entityId: String(id),
    metadata: { poNumber: po.poNumber, reason: reason || "Rejected" },
    actorUserId: userId,
  });
  return updated;
}

export async function cancelPurchaseOrder(id: number, orgId: number, reason?: string, actorUserId?: number) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, orgId } });
  if (!po) throw new Error("Purchase order not found");
  if (["RECEIVED", "CANCELLED", "REJECTED"].includes(po.status)) {
    throw new Error(`Cannot cancel PO in status ${po.status}`);
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    },
    include: { vendor: { select: { id: true, name: true } }, lines: true },
  });
  let whId: number | null = null;
  if (po.warehouseId != null) {
    const validation = await validateWarehouseAccess({
      orgId,
      warehouseId: po.warehouseId,
    });
    whId = validation.valid ? po.warehouseId : null;
  }
  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "PO_CANCEL",
    entityType: "PurchaseOrder",
    entityId: String(id),
    metadata: { poNumber: po.poNumber, reason: reason ?? null },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

/** After GRN receive: increment PO line receivedQty and roll up PO status. Call inside same transaction as GRN receive. */
export async function applyGrnReceiveToPurchaseOrder(
  tx: Prisma.TransactionClient,
  grnId: number,
  purchaseOrderId: number,
  orgId: number
) {
  const grn = await tx.grn.findFirst({
    where: { id: grnId, orgId, purchaseOrderId },
    include: { lines: true },
  });
  if (!grn) return;

  const po = await tx.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, orgId },
    include: { lines: true },
  });
  if (!po) return;

  for (const gl of grn.lines) {
    let pol:
      | (typeof po.lines)[0]
      | undefined;
    if (gl.purchaseOrderLineId != null) {
      pol = po.lines.find((l) => l.id === gl.purchaseOrderLineId);
    } else {
      const sameVariant = po.lines.filter((l) => l.variantId === gl.variantId);
      if (sameVariant.length === 1) pol = sameVariant[0];
      else if (sameVariant.length > 1) {
        throw new Error(
          `GRN line for variant ${gl.variantId} requires purchaseOrderLineId because the PO has multiple lines for this variant`
        );
      }
    }
    if (!pol) continue;
    const extra = gl.quantityExtra != null ? Number(gl.quantityExtra) : 0;
    const add = Number(gl.quantity) + (Number.isFinite(extra) ? extra : 0);
    const nextRecv = pol.receivedQty + add;
    await tx.purchaseOrderLine.update({
      where: { id: pol.id },
      data: { receivedQty: nextRecv },
    });
  }

  const refreshed = await tx.purchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!refreshed) return;

  const lines = refreshed.lines;
  if (!lines.length) return;
  const allReceived = lines.every((l) => l.receivedQty >= l.orderedQty);
  const anyReceived = lines.some((l) => l.receivedQty > 0);
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(refreshed.status)) return;

  if (allReceived) {
    await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: "RECEIVED" } });
  } else if (anyReceived) {
    await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: "PARTIALLY_RECEIVED" } });
  }
}

/**
 * Create PO from an approved procurement stock request.
 * Links the PO back to the StockRequest and transitions request to APPROVED.
 */
export async function createPurchaseOrderFromStockRequest(opts: {
  stockRequestId: number;
  vendorId: number;
  orgId: number;
  createdByUserId: number;
  warehouseId?: number;
  expectedDeliveryDate?: Date;
  notes?: string;
  currency?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.stockRequest.findFirst({
      where: { id: opts.stockRequestId, orgId: opts.orgId },
      include: {
        items: {
          include: {
            variant: { select: { id: true, sku: true, productId: true } },
            product: { select: { id: true, name: true } },
          },
        },
        branch: {
          select: {
            id: true, name: true,
            warehouses: { where: { isActive: true }, select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!request) throw new Error("Stock request not found");
    if (request.requestIntent !== "PROCUREMENT") {
      throw new Error("Only PROCUREMENT intent requests can be converted to purchase orders");
    }
    if (!["SUBMITTED", "OWNER_REVIEW", "APPROVED"].includes(request.status)) {
      throw new Error(`Cannot create PO from request in status ${request.status}`);
    }

    const resolvedWarehouseId = opts.warehouseId ??
      request.branch?.warehouses?.[0]?.id ?? undefined;

    const poData = {
      orgId: opts.orgId,
      vendorId: opts.vendorId,
      warehouseId: resolvedWarehouseId,
      lines: request.items
        .filter((i: any) => i.lineKind !== "EXTRA")
        .map((i: any) => ({
          variantId: i.variantId,
          orderedQty: i.requestedQty,
          note: i.note ?? undefined,
        })),
      expectedDeliveryDate: opts.expectedDeliveryDate,
      notes: opts.notes ?? request.procurementNote ?? undefined,
      currency: opts.currency,
      createdByUserId: opts.createdByUserId,
    };

    const po = await createPurchaseOrderWithClient(tx, poData);

    await tx.stockRequest.update({
      where: { id: opts.stockRequestId },
      data: {
        linkedPurchaseOrderId: po.id,
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByUserId: opts.createdByUserId,
      },
    });

    return po;
  });
}

/**
 * Pending vendor PO receipts for a branch-backed warehouse.
 * Returns APPROVED and PARTIALLY_RECEIVED POs where the linked warehouse has branchId = branchId
 * and pendingQty > 0. Used by the warehouse staff Receive Center.
 */
export async function listPendingPoReceiptsForBranch(branchId: number, orgId: number) {
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      orgId,
      status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] },
      warehouse: { branchId, isActive: true },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true, branchId: true } },
      lines: { select: { id: true, orderedQty: true, receivedQty: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return pos
    .map((po) => {
      const totalOrderedQty = po.lines.reduce((s, l) => s + l.orderedQty, 0);
      const totalReceivedQty = po.lines.reduce((s, l) => s + Number(l.receivedQty), 0);
      const pendingQty = po.lines.reduce((s, l) => s + Math.max(0, l.orderedQty - Number(l.receivedQty)), 0);
      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        vendorId: po.vendor?.id ?? null,
        vendorName: po.vendor?.name ?? null,
        expectedDeliveryDate: po.expectedDeliveryDate ?? null,
        lineCount: po.lines.length,
        pendingQty,
        totalOrderedQty,
        totalReceivedQty,
        warehouseId: po.warehouseId ?? null,
        warehouseName: po.warehouse?.name ?? null,
        createdAt: po.createdAt,
      };
    })
    .filter((po) => po.pendingQty > 0);
}
