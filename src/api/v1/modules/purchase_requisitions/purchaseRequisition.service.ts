/**
 * Purchase requisitions (internal) → convert to PurchaseOrder.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import {
  createPurchaseOrderWithClient,
} from "../purchase_orders/purchaseOrder.service";
import { assertVariantsBelongToOrg } from "../_shared/variantOrgValidation";

async function nextPrNumber(orgId: number): Promise<string> {
  const count = await prisma.purchaseRequisition.count({ where: { orgId } });
  return `PR-${orgId}-${String(count + 1).padStart(5, "0")}`;
}

export async function createPurchaseRequisition(data: {
  orgId: number;
  warehouseId?: number | null;
  vendorId?: number | null;
  notes?: string | null;
  lines: Array<{ variantId: number; requestedQty: number; unitCost?: number | null; note?: string | null }>;
  requestedByUserId?: number | null;
}) {
  if (!data.lines?.length) throw new Error("At least one line is required");
  for (const l of data.lines) {
    if (!Number.isInteger(l.requestedQty) || l.requestedQty < 1) {
      throw new Error("Each line must have requestedQty >= 1");
    }
  }
  if (data.vendorId != null) {
    const v = await prisma.vendor.findFirst({ where: { id: data.vendorId, orgId: data.orgId } });
    if (!v) throw new Error("Vendor not found");
  }
  if (data.warehouseId != null) {
    const w = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, orgId: data.orgId } });
    if (!w) throw new Error("Warehouse not found");
  }

  await assertVariantsBelongToOrg(
    data.orgId,
    data.lines.map((l) => l.variantId)
  );

  const prNumber = await nextPrNumber(data.orgId);
  return prisma.purchaseRequisition.create({
    data: {
      orgId: data.orgId,
      prNumber,
      status: "DRAFT",
      warehouseId: data.warehouseId ?? undefined,
      vendorId: data.vendorId ?? undefined,
      notes: data.notes ?? undefined,
      requestedByUserId: data.requestedByUserId ?? undefined,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          requestedQty: l.requestedQty,
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

export async function listPurchaseRequisitions(
  orgId: number,
  opts?: { status?: string; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: Prisma.PurchaseRequisitionWhereInput = { orgId };
  if (opts?.status) where.status = opts.status as any;
  const [items, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        lines: { select: { id: true, variantId: true, requestedQty: true, convertedQty: true } },
      },
    }),
    prisma.purchaseRequisition.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getPurchaseRequisitionById(id: number, orgId: number) {
  return prisma.purchaseRequisition.findFirst({
    where: { id, orgId },
    include: {
      vendor: { select: { id: true, name: true, phone: true, email: true, status: true } },
      warehouse: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
      purchaseOrders: { select: { id: true, poNumber: true, status: true, createdAt: true } },
    },
  });
}

export async function submitPurchaseRequisition(id: number, orgId: number, actorUserId?: number) {
  const pr = await prisma.purchaseRequisition.findFirst({ where: { id, orgId } });
  if (!pr) throw new Error("Purchase requisition not found");
  if (pr.status !== "DRAFT") throw new Error(`Cannot submit PR in status ${pr.status}`);
  const updated = await prisma.purchaseRequisition.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: pr.warehouseId,
    category: "OPERATIONS",
    action: "PR_SUBMIT",
    entityType: "PurchaseRequisition",
    entityId: String(id),
    metadata: { prNumber: pr.prNumber },
    actorUserId: actorUserId ?? null,
  });
  return updated;
}

export async function approvePurchaseRequisition(id: number, orgId: number, approverUserId: number) {
  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, orgId },
    include: { vendor: { select: { id: true, status: true } } },
  });
  if (!pr) throw new Error("Purchase requisition not found");
  if (pr.vendor?.status === "BLACKLISTED") {
    throw new Error("Cannot approve a requisition tied to a blacklisted supplier");
  }
  if (pr.status !== "SUBMITTED") {
    throw new Error(`Cannot approve PR in status ${pr.status}`);
  }
  const updated = await prisma.purchaseRequisition.update({
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
  await logWarehouseAudit({
    orgId,
    warehouseId: pr.warehouseId,
    category: "OPERATIONS",
    action: "PR_APPROVE",
    entityType: "PurchaseRequisition",
    entityId: String(id),
    metadata: { prNumber: pr.prNumber },
    actorUserId: approverUserId,
  });
  return updated;
}

export async function rejectPurchaseRequisition(id: number, orgId: number, userId: number, reason: string) {
  const pr = await prisma.purchaseRequisition.findFirst({ where: { id, orgId } });
  if (!pr) throw new Error("Purchase requisition not found");
  if (pr.status !== "SUBMITTED") {
    throw new Error(`Cannot reject PR in status ${pr.status}`);
  }
  const updated = await prisma.purchaseRequisition.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedByUserId: userId,
      rejectionReason: reason || "Rejected",
    },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: pr.warehouseId,
    category: "OPERATIONS",
    action: "PR_REJECT",
    entityType: "PurchaseRequisition",
    entityId: String(id),
    metadata: { prNumber: pr.prNumber, reason: reason || "Rejected" },
    actorUserId: userId,
  });
  return updated;
}

/**
 * Convert approved PR lines to a draft PO. Bumps convertedQty on PR lines.
 */
export async function convertPurchaseRequisitionToPo(
  id: number,
  orgId: number,
  actorUserId: number,
  opts?: { lineSelections?: Array<{ lineId: number; qty: number }> }
) {
  const pr = await prisma.purchaseRequisition.findFirst({
    where: { id, orgId },
    include: { lines: true, vendor: true },
  });
  if (!pr) throw new Error("Purchase requisition not found");
  if (pr.status !== "APPROVED") throw new Error("Only APPROVED purchase requisitions can be converted");
  if (!pr.vendorId) throw new Error("PR must have a preferred vendor to convert to PO");

  const vendor = await prisma.vendor.findFirst({ where: { id: pr.vendorId, orgId } });
  if (!vendor) throw new Error("Vendor not found");
  if (vendor.status === "BLACKLISTED") throw new Error("Cannot convert PR for blacklisted supplier");

  const poLines: Array<{
    prLineId: number;
    variantId: number;
    orderedQty: number;
    unitCost?: number | null;
    note?: string | null;
  }> = [];

  const selectionMap = new Map((opts?.lineSelections ?? []).map((s) => [s.lineId, s.qty]));
  for (const line of pr.lines) {
    const remaining = line.requestedQty - line.convertedQty;
    if (remaining <= 0) continue;
    let qty = remaining;
    if (selectionMap.has(line.id)) {
      qty = Math.min(remaining, Math.max(1, selectionMap.get(line.id)!));
    }
    if (qty < 1) continue;
    poLines.push({
      prLineId: line.id,
      variantId: line.variantId,
      orderedQty: qty,
      unitCost: line.unitCost != null ? Number(line.unitCost) : undefined,
      note: line.note,
    });
  }

  if (!poLines.length) throw new Error("No remaining quantity to convert on this requisition");

  return prisma.$transaction(async (tx) => {
    const po = await createPurchaseOrderWithClient(tx, {
      orgId,
      vendorId: pr.vendorId!,
      warehouseId: pr.warehouseId,
      purchaseRequisitionId: pr.id,
      lines: poLines.map((p) => ({
        variantId: p.variantId,
        orderedQty: p.orderedQty,
        unitCost: p.unitCost,
        note: p.note,
      })),
      notes: pr.notes,
      createdByUserId: actorUserId,
    });

    for (const p of poLines) {
      await tx.purchaseRequisitionLine.update({
        where: { id: p.prLineId },
        data: { convertedQty: { increment: p.orderedQty } },
      });
    }

    const refreshed = await tx.purchaseRequisition.findFirst({
      where: { id: pr.id },
      include: { lines: true },
    });
    const allConverted = refreshed?.lines.every((l) => l.convertedQty >= l.requestedQty);
    if (allConverted) {
      await tx.purchaseRequisition.update({ where: { id: pr.id }, data: { status: "CONVERTED" } });
    }

    return po;
  }).then(async (po) => {
    await logWarehouseAudit({
      orgId,
      warehouseId: pr.warehouseId,
      category: "OPERATIONS",
      action: "PR_CONVERT_TO_PO",
      entityType: "PurchaseOrder",
      entityId: String((po as { id: number }).id),
      metadata: { purchaseRequisitionId: pr.id, prNumber: pr.prNumber },
      actorUserId,
    });
    return po;
  });
}
