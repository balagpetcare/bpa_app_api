import prisma from "../../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { assertVariantsBelongToOrg } from "../_shared/variantOrgValidation";

export async function createInboundDiscrepancy(data: {
  orgId: number;
  grnId: number;
  grnLineId?: number | null;
  purchaseOrderLineId?: number | null;
  variantId: number;
  discrepancyType: string;
  quantity: number;
  reasonCode?: string | null;
  notes?: string | null;
  actorUserId?: number | null;
}) {
  const grn = await prisma.grn.findFirst({ where: { id: data.grnId, orgId: data.orgId } });
  if (!grn) throw new Error("GRN not found");

  if (data.grnLineId != null) {
    const gl = await prisma.grnLine.findFirst({
      where: { id: data.grnLineId, grnId: data.grnId },
    });
    if (!gl) throw new Error("GRN line does not belong to this GRN");
    if (gl.variantId !== data.variantId) {
      throw new Error("Variant does not match the specified GRN line");
    }
  }

  await assertVariantsBelongToOrg(data.orgId, [data.variantId]);

  const row = await prisma.inboundDiscrepancy.create({
    data: {
      orgId: data.orgId,
      grnId: data.grnId,
      grnLineId: data.grnLineId ?? undefined,
      purchaseOrderLineId: data.purchaseOrderLineId ?? undefined,
      variantId: data.variantId,
      discrepancyType: data.discrepancyType,
      quantity: data.quantity,
      reasonCode: data.reasonCode ?? undefined,
      notes: data.notes ?? undefined,
    },
  });

  const whId = await prisma.inventoryLocation
    .findUnique({ where: { id: grn.locationId }, select: { warehouseId: true } })
    .then((l) => l?.warehouseId ?? null);

  await logWarehouseAudit({
    orgId: data.orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "INBOUND_VARIANCE",
    entityType: "InboundDiscrepancy",
    entityId: String(row.id),
    metadata: { grnId: data.grnId, type: data.discrepancyType, qty: data.quantity },
    actorUserId: data.actorUserId ?? null,
  });

  return row;
}

export async function listInboundDiscrepancies(
  orgId: number,
  opts?: { status?: string; grnId?: number; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: any = { orgId };
  if (opts?.status) where.status = opts.status;
  if (opts?.grnId) where.grnId = opts.grnId;
  const [items, total] = await Promise.all([
    prisma.inboundDiscrepancy.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        grn: { select: { id: true, status: true, invoiceNo: true } },
      },
    }),
    prisma.inboundDiscrepancy.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function resolveInboundDiscrepancy(
  id: number,
  orgId: number,
  userId: number,
  resolutionNote?: string | null
) {
  const row = await prisma.inboundDiscrepancy.findFirst({
    where: { id, orgId },
    include: { grn: { select: { id: true, locationId: true } } },
  });
  if (!row) throw new Error("Discrepancy not found");
  if (row.status !== "OPEN") throw new Error("Already resolved or cancelled");
  const updated = await prisma.inboundDiscrepancy.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByUserId: userId,
      resolutionNote: resolutionNote ?? undefined,
    },
  });

  const whId = await prisma.inventoryLocation
    .findUnique({ where: { id: row.grn.locationId }, select: { warehouseId: true } })
    .then((l) => l?.warehouseId ?? null);

  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "INBOUND_VARIANCE_RESOLVED",
    entityType: "InboundDiscrepancy",
    entityId: String(id),
    metadata: { grnId: row.grnId, resolutionNote: resolutionNote ?? null },
    actorUserId: userId,
  });

  return updated;
}
