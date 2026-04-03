/**
 * Purchase orders (org-scoped, vendor-linked).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";

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

  if (data.warehouseId != null) {
    const wh = await db.warehouse.findFirst({
      where: { id: data.warehouseId, orgId: data.orgId },
    });
    if (!wh) throw new Error("Warehouse not found for organization");
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

  return db.purchaseOrder.create({
    data: {
      orgId: data.orgId,
      vendorId: data.vendorId,
      warehouseId: data.warehouseId ?? undefined,
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
      warehouse: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
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
        warehouse: { select: { id: true, name: true } },
        lines: { select: { id: true, variantId: true, orderedQty: true, receivedQty: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

const actorSelect = {
  id: true,
  profile: { select: { displayName: true, username: true } },
} as const;

export async function getPurchaseOrderById(id: number, orgId: number) {
  return prisma.purchaseOrder.findFirst({
    where: { id, orgId },
    include: {
      vendor: { select: { id: true, name: true, phone: true, email: true } },
      warehouse: { select: { id: true, name: true } },
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
        },
      },
      purchaseRequisition: { select: { id: true, prNumber: true, status: true } },
      createdBy: { select: actorSelect },
      approvedBy: { select: actorSelect },
      rejectedBy: { select: actorSelect },
    },
  });
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
    const w = await prisma.warehouse.findFirst({ where: { id: po.warehouseId, orgId }, select: { id: true } });
    whId = w?.id ?? null;
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
    const w = await prisma.warehouse.findFirst({ where: { id: po.warehouseId, orgId }, select: { id: true } });
    whId = w?.id ?? null;
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
    const w = await prisma.warehouse.findFirst({ where: { id: po.warehouseId, orgId }, select: { id: true } });
    whId = w?.id ?? null;
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
    const w = await prisma.warehouse.findFirst({ where: { id: po.warehouseId, orgId }, select: { id: true } });
    whId = w?.id ?? null;
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
    const add = gl.quantity;
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
