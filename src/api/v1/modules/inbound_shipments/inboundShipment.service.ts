import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { assertVariantsBelongToOrg } from "../_shared/variantOrgValidation";

export async function createInboundShipment(data: {
  orgId: number;
  vendorId: number;
  purchaseOrderId?: number | null;
  reference: string;
  expectedArrivalAt?: Date | null;
  shipToWarehouseId?: number | null;
  shipFromJson?: Prisma.InputJsonValue | null;
  metaJson?: Prisma.InputJsonValue | null;
  lines: Array<{
    variantId: number;
    expectedQty: number;
    purchaseOrderLineId?: number | null;
    batchHint?: string | null;
  }>;
}) {
  const vendor = await prisma.vendor.findFirst({ where: { id: data.vendorId, orgId: data.orgId } });
  if (!vendor) throw new Error("Vendor not found");
  if (data.purchaseOrderId != null) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: data.purchaseOrderId, orgId: data.orgId },
    });
    if (!po) throw new Error("Purchase order not found");
  }
  if (data.shipToWarehouseId != null) {
    const w = await prisma.warehouse.findFirst({
      where: { id: data.shipToWarehouseId, orgId: data.orgId },
    });
    if (!w) throw new Error("Warehouse not found");
  }
  if (!data.lines?.length) throw new Error("At least one line is required");

  await assertVariantsBelongToOrg(
    data.orgId,
    data.lines.map((l) => l.variantId)
  );

  return prisma.inboundShipment.create({
    data: {
      orgId: data.orgId,
      vendorId: data.vendorId,
      purchaseOrderId: data.purchaseOrderId ?? undefined,
      reference: data.reference.trim(),
      expectedArrivalAt: data.expectedArrivalAt ?? undefined,
      shipToWarehouseId: data.shipToWarehouseId ?? undefined,
      shipFromJson: data.shipFromJson ?? undefined,
      metaJson: data.metaJson ?? undefined,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          expectedQty: l.expectedQty,
          purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
          batchHint: l.batchHint ?? undefined,
        })),
      },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
}

export async function listInboundShipments(
  orgId: number,
  opts?: { status?: string; vendorId?: number; page?: number; limit?: number }
) {
  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const where: Prisma.InboundShipmentWhereInput = { orgId };
  if (opts?.status) where.status = opts.status as any;
  if (opts?.vendorId) where.vendorId = opts.vendorId;
  const [items, total] = await Promise.all([
    prisma.inboundShipment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        lines: { select: { id: true, variantId: true, expectedQty: true, receivedQtySnapshot: true } },
      },
    }),
    prisma.inboundShipment.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getInboundShipmentById(id: number, orgId: number) {
  return prisma.inboundShipment.findFirst({
    where: { id, orgId },
    include: {
      vendor: true,
      purchaseOrder: { include: { lines: true } },
      shipToWarehouse: { select: { id: true, name: true } },
      lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
    },
  });
}

export async function patchInboundShipment(
  id: number,
  orgId: number,
  data: {
    status?: string;
    expectedArrivalAt?: Date | null;
    metaJson?: Prisma.InputJsonValue | null;
  }
) {
  const row = await prisma.inboundShipment.findFirst({ where: { id, orgId } });
  if (!row) throw new Error("Inbound shipment not found");
  return prisma.inboundShipment.update({
    where: { id },
    data: {
      status: (data.status as any) ?? undefined,
      expectedArrivalAt: data.expectedArrivalAt,
      metaJson: data.metaJson ?? undefined,
    },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: true,
    },
  });
}

/** After GRN receive: bump receivedQtySnapshot on linked shipment lines. */
export async function applyGrnLinesToInboundShipmentSnapshots(
  tx: Prisma.TransactionClient,
  grnId: number,
  orgId: number
) {
  const grn = await tx.grn.findFirst({
    where: { id: grnId, orgId },
    include: { lines: true },
  });
  if (!grn?.inboundShipmentId) return;

  for (const gl of grn.lines) {
    if (!gl.inboundShipmentLineId) continue;
    const isl = await tx.inboundShipmentLine.findFirst({
      where: { id: gl.inboundShipmentLineId, inboundShipmentId: grn.inboundShipmentId },
    });
    if (!isl) continue;
    await tx.inboundShipmentLine.update({
      where: { id: isl.id },
      data: { receivedQtySnapshot: { increment: gl.quantity } },
    });
  }
}
