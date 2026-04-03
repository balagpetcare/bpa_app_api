/**
 * GRN (Goods Received Note) service.
 * Receive creates StockLot when needed and writes StockLedger GRN_IN (single source of truth).
 */
import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");
import { logWarehouseAuditInTx, logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { assertVariantsBelongToOrg } from "../_shared/variantOrgValidation";

const purchaseOrderHooks = require("../purchase_orders/purchaseOrder.service");

export type CreateGrnLineInput = {
  variantId: number;
  quantity: number;
  unitCost?: number;
  lotCode?: string;
  mfgDate?: string;
  expDate?: string;
  inboundShipmentLineId?: number | null;
  purchaseOrderLineId?: number | null;
  quantityDamaged?: number;
  quantityShort?: number;
  supplierBarcode?: string;
  receiveBarcode?: string;
  landedUnitCost?: number;
  lineRemarks?: string;
};

export type CreateGrnInput = {
  orgId: number;
  vendorId?: number | null;
  /** When set, vendorId is taken from PO if omitted; lines must match PO variants. */
  purchaseOrderId?: number | null;
  inboundShipmentId?: number | null;
  locationId: number;
  invoiceNo?: string;
  invoiceDate?: string;
  notes?: string;
  /** Idempotent bulk receive: same org + key returns existing GRN. */
  receiveIdempotencyKey?: string | null;
  lines: CreateGrnLineInput[];
};

function resolvePurchaseOrderLineId(
  po: { poNumber: string; lines: Array<{ id: number; variantId: number }> },
  line: CreateGrnLineInput
): number {
  if (line.purchaseOrderLineId != null) {
    const pol = po.lines.find((x) => x.id === line.purchaseOrderLineId);
    if (!pol || pol.variantId !== line.variantId) {
      throw new Error("purchaseOrderLineId does not match variant on this PO");
    }
    return pol.id;
  }
  const matches = po.lines.filter((x) => x.variantId === line.variantId);
  if (matches.length === 0) throw new Error(`Variant ${line.variantId} is not on purchase order ${po.poNumber}`);
  if (matches.length > 1) {
    throw new Error(
      `Variant ${line.variantId} appears on multiple PO lines; pass purchaseOrderLineId on each GRN line`
    );
  }
  return matches[0].id;
}

/** Validates cumulative receive (prior GRNs + this GRN) against ordered qty and warehouse over-receipt tolerance. */
export async function validatePoGrnLinesAgainstWarehouse(
  db: Prisma.TransactionClient | typeof prisma,
  params: {
    orgId: number;
    purchaseOrderId: number;
    locationId: number;
    lines: Array<{ variantId: number; quantity: number; purchaseOrderLineId: number }>;
  }
) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: params.purchaseOrderId, orgId: params.orgId },
    include: { lines: true },
  });
  if (!po) throw new Error("Purchase order not found");

  const loc = await db.inventoryLocation.findUnique({
    where: { id: params.locationId },
    select: { warehouseId: true },
  });
  let tol: number | null = null;
  if (loc?.warehouseId) {
    const w = await db.warehouse.findUnique({
      where: { id: loc.warehouseId },
      select: { poOverReceiptTolerancePercent: true },
    });
    tol = w?.poOverReceiptTolerancePercent != null ? Number(w.poOverReceiptTolerancePercent) : null;
  }

  for (const line of params.lines) {
    const pol = po.lines.find((l) => l.id === line.purchaseOrderLineId);
    if (!pol) throw new Error("Invalid purchase order line for this PO");
    const cap = tol == null ? Number.POSITIVE_INFINITY : pol.orderedQty * (1 + tol / 100);
    const next = pol.receivedQty + line.quantity;
    if (next > cap + 1e-6) {
      throw new Error(
        `Over-receipt on PO line ${pol.id}: incoming ${line.quantity} would exceed allowed total ${cap.toFixed(2)} (ordered ${pol.orderedQty}, tolerance ${tol == null ? "unlimited" : `${tol}%`}, already received ${pol.receivedQty})`
      );
    }
  }
}

export type ListGrnFilter = {
  orgId: number;
  locationId?: number;
  /** Restrict to all active locations linked to this warehouse (must belong to orgId). */
  warehouseId?: number;
  vendorId?: number;
  /** Filter GRNs linked to a specific purchase order. */
  purchaseOrderId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

export async function getOrgIdsForUser(userId: number): Promise<number[]> {
  const ownerOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (ownerOrgs.length) return ownerOrgs.map((o) => o.id);
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member ? [member.orgId] : [];
}

export async function createGrn(data: CreateGrnInput) {
  if (!data.lines?.length) throw new Error("At least one line is required");
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: data.locationId },
    include: { branch: true },
  });
  if (!location || location.branch.orgId !== data.orgId) {
    throw new Error("Location not found or does not belong to organization");
  }

  const idemKey =
    data.receiveIdempotencyKey != null && String(data.receiveIdempotencyKey).trim()
      ? String(data.receiveIdempotencyKey).trim().slice(0, 64)
      : null;
  if (idemKey) {
    const existing = await prisma.grn.findFirst({
      where: { orgId: data.orgId, receiveIdempotencyKey: idemKey },
      include: {
        vendor: { select: { id: true, name: true } },
        location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            purchaseOrderLine: { select: { id: true, orderedQty: true, receivedQty: true } },
          },
        },
      },
    });
    if (existing) {
      if (existing.status === "VOIDED") throw new Error("receiveIdempotencyKey refers to a voided GRN");
      return getGrnById(existing.id, data.orgId);
    }
  }

  await assertVariantsBelongToOrg(
    data.orgId,
    data.lines.map((l) => l.variantId)
  );

  let vendorId: number | null = data.vendorId != null ? data.vendorId : null;
  let purchaseOrderId: number | null = data.purchaseOrderId != null ? data.purchaseOrderId : null;

  const resolvedLines: Array<CreateGrnLineInput & { purchaseOrderLineId: number | null }> = [];

  if (purchaseOrderId != null) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, orgId: data.orgId },
      include: { lines: true },
    });
    if (!po) throw new Error("Purchase order not found");
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) {
      throw new Error(`GRN cannot reference PO in status ${po.status}`);
    }
    vendorId = po.vendorId;
    for (const l of data.lines) {
      const polId = resolvePurchaseOrderLineId(po, l);
      resolvedLines.push({ ...l, purchaseOrderLineId: polId });
    }
    await validatePoGrnLinesAgainstWarehouse(prisma, {
      orgId: data.orgId,
      purchaseOrderId,
      locationId: data.locationId,
      lines: resolvedLines.map((x) => ({
        variantId: x.variantId,
        quantity: x.quantity,
        purchaseOrderLineId: x.purchaseOrderLineId!,
      })),
    });
  } else {
    for (const l of data.lines) {
      resolvedLines.push({ ...l, purchaseOrderLineId: null });
    }
  }

  if (vendorId != null) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, orgId: data.orgId },
    });
    if (!vendor) throw new Error("Vendor not found or does not belong to organization");
  }

  const grn = await prisma.grn.create({
    data: {
      orgId: data.orgId,
      vendorId: vendorId ?? undefined,
      purchaseOrderId: purchaseOrderId ?? undefined,
      inboundShipmentId: data.inboundShipmentId ?? undefined,
      locationId: data.locationId,
      status: "DRAFT",
      invoiceNo: data.invoiceNo ?? null,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      notes: data.notes ?? null,
      receiveIdempotencyKey: idemKey ?? undefined,
      lines: {
        create: resolvedLines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          quantityDamaged: l.quantityDamaged != null ? Math.max(0, Math.floor(l.quantityDamaged)) : undefined,
          quantityShort: l.quantityShort != null ? Math.max(0, Math.floor(l.quantityShort)) : undefined,
          unitCost: l.unitCost != null ? l.unitCost : null,
          landedUnitCost: l.landedUnitCost != null ? l.landedUnitCost : null,
          lotCode: l.lotCode ?? null,
          mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
          expDate: l.expDate ? new Date(l.expDate) : null,
          inboundShipmentLineId: l.inboundShipmentLineId ?? undefined,
          purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
          supplierBarcode: l.supplierBarcode != null ? String(l.supplierBarcode).trim().slice(0, 128) : null,
          receiveBarcode: l.receiveBarcode != null ? String(l.receiveBarcode).trim().slice(0, 128) : null,
          lineRemarks: l.lineRemarks ?? null,
        })),
      },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          purchaseOrderLine: { select: { id: true, orderedQty: true, receivedQty: true } },
        },
      },
    },
  });

  const locWh = await prisma.inventoryLocation.findUnique({
    where: { id: data.locationId },
    select: { warehouseId: true },
  });
  await logWarehouseAudit({
    orgId: data.orgId,
    warehouseId: locWh?.warehouseId ?? null,
    category: "OPERATIONS",
    action: "GRN_CREATED",
    entityType: "GRN",
    entityId: String(grn.id),
    metadata: {
      purchaseOrderId: purchaseOrderId ?? null,
      vendorId: vendorId ?? null,
      lineCount: resolvedLines.length,
    },
    actorUserId: null,
  });

  return grn;
}

export async function listGrns(filter: ListGrnFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = { orgId: filter.orgId };
  if (filter.warehouseId != null) {
    const locs = await prisma.inventoryLocation.findMany({
      where: {
        warehouseId: filter.warehouseId,
        isActive: true,
        branch: { orgId: filter.orgId },
      },
      select: { id: true },
    });
    const ids = locs.map((l: { id: number }) => l.id);
    if (!ids.length) {
      return {
        items: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }
    where.locationId = { in: ids };
  } else if (filter.locationId) {
    where.locationId = filter.locationId;
  }
  if (filter.vendorId) where.vendorId = filter.vendorId;
  if (filter.purchaseOrderId) where.purchaseOrderId = filter.purchaseOrderId;
  if (filter.status) where.status = filter.status;
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
    prisma.grn.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
      },
    }),
    prisma.grn.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getGrnById(grnId: number, orgId: number) {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      vendor: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true } },
      qcInspections: {
        select: {
          id: true,
          status: true,
          expectedQty: true,
          passedQty: true,
          failedQty: true,
          grnLineId: true,
          disposition: true,
        },
      },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true, productId: true, barcode: true } },
          purchaseOrderLine: { select: { id: true, orderedQty: true, receivedQty: true, unitCost: true } },
          lot: { select: { id: true, lotCode: true, expDate: true, mfgDate: true, supplierBarcode: true } },
        },
      },
    },
  });
  return grn;
}

export async function updateGrn(
  grnId: number,
  orgId: number,
  data: {
    notes?: string;
    invoiceNo?: string;
    invoiceDate?: string;
    lines?: CreateGrnLineInput[];
  }
) {
  const existing = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: { status: true, purchaseOrderId: true, locationId: true },
  });
  if (!existing) throw new Error("GRN not found");
  if (existing.status !== "DRAFT") throw new Error("Only DRAFT GRN can be updated");

  const updateData: any = {};
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.invoiceNo !== undefined) updateData.invoiceNo = data.invoiceNo ?? null;
  if (data.invoiceDate !== undefined) updateData.invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : null;
  if (Object.keys(updateData).length) {
    await prisma.grn.update({ where: { id: grnId }, data: updateData });
  }
  if (data.lines !== undefined) {
    if (data.lines.length) {
      await assertVariantsBelongToOrg(
        orgId,
        data.lines.map((l) => l.variantId)
      );
    }
    let resolvedForPo: Array<CreateGrnLineInput & { purchaseOrderLineId: number | null }> = [];
    if (existing.purchaseOrderId != null && data.lines.length) {
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: existing.purchaseOrderId, orgId },
        include: { lines: true },
      });
      if (!po) throw new Error("Purchase order not found");
      resolvedForPo = data.lines.map((l) => ({
        ...l,
        purchaseOrderLineId: resolvePurchaseOrderLineId(po, l),
      }));
      await validatePoGrnLinesAgainstWarehouse(prisma, {
        orgId,
        purchaseOrderId: existing.purchaseOrderId,
        locationId: existing.locationId,
        lines: resolvedForPo.map((x) => ({
          variantId: x.variantId,
          quantity: x.quantity,
          purchaseOrderLineId: x.purchaseOrderLineId!,
        })),
      });
    } else {
      resolvedForPo = data.lines.map((l) => ({ ...l, purchaseOrderLineId: l.purchaseOrderLineId ?? null }));
    }
    await prisma.$transaction(async (tx: any) => {
      await tx.grnLine.deleteMany({ where: { grnId } });
      if (resolvedForPo.length) {
        await tx.grnLine.createMany({
          data: resolvedForPo.map((l) => ({
            grnId,
            variantId: l.variantId,
            quantity: l.quantity,
            quantityDamaged: l.quantityDamaged != null ? Math.max(0, Math.floor(l.quantityDamaged)) : 0,
            quantityShort: l.quantityShort != null ? Math.max(0, Math.floor(l.quantityShort)) : 0,
            unitCost: l.unitCost != null ? l.unitCost : null,
            landedUnitCost: l.landedUnitCost != null ? l.landedUnitCost : null,
            lotCode: l.lotCode ?? null,
            mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
            expDate: l.expDate ? new Date(l.expDate) : null,
            inboundShipmentLineId: l.inboundShipmentLineId ?? undefined,
            purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
            supplierBarcode: l.supplierBarcode != null ? String(l.supplierBarcode).trim().slice(0, 128) : null,
            receiveBarcode: l.receiveBarcode != null ? String(l.receiveBarcode).trim().slice(0, 128) : null,
            lineRemarks: l.lineRemarks ?? null,
          })),
        });
      }
    });
  }
  return getGrnById(grnId, orgId);
}

export async function receiveGrn(grnId: number, orgId: number, userId: number) {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      location: { include: { branch: true } },
      lines: true,
    },
  });
  if (!grn) throw new Error("GRN not found");
  if (grn.status === "VOIDED") throw new Error("GRN is voided");
  if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRN can be received");

  const org = grn.location.branch.orgId;
  if (org !== orgId) {
    throw new Error("GRN location does not match organization");
  }

  await prisma.$transaction(async (tx: any) => {
    if (grn.purchaseOrderId != null) {
      const poFull = await tx.purchaseOrder.findFirst({
        where: { id: grn.purchaseOrderId, orgId },
        include: { lines: true },
      });
      if (!poFull) throw new Error("Purchase order not found");
      const validated: Array<{ variantId: number; quantity: number; purchaseOrderLineId: number }> = [];
      for (const line of grn.lines) {
        let polId = line.purchaseOrderLineId;
        if (polId == null) {
          const matches = poFull.lines.filter((l: { variantId: number }) => l.variantId === line.variantId);
          if (matches.length !== 1) {
            throw new Error(
              `GRN line ${line.id} must have purchaseOrderLineId set (multiple or zero PO lines for this variant)`
            );
          }
          polId = matches[0].id;
        } else {
          const pol = poFull.lines.find((l: { id: number }) => l.id === polId);
          if (!pol || pol.variantId !== line.variantId) {
            throw new Error("GRN line purchaseOrderLineId does not match variant");
          }
        }
        if (polId != null && line.purchaseOrderLineId !== polId) {
          await tx.grnLine.update({ where: { id: line.id }, data: { purchaseOrderLineId: polId } });
        }
        validated.push({
          variantId: line.variantId,
          quantity: line.quantity,
          purchaseOrderLineId: polId,
        });
      }
      await validatePoGrnLinesAgainstWarehouse(tx, {
        orgId,
        purchaseOrderId: grn.purchaseOrderId,
        locationId: grn.locationId,
        lines: validated,
      });
    }

    const locRow = await tx.inventoryLocation.findUnique({
      where: { id: grn.locationId },
      select: { warehouseId: true },
    });
    let qcWarehouseId: number | null = null;
    let qcInbound = false;
    let whForEscalation: { poReceiveEscalationMinTotal: unknown } | null = null;
    if (locRow?.warehouseId) {
      const w = await tx.warehouse.findUnique({
        where: { id: locRow.warehouseId },
        select: { id: true, qcInboundEnabled: true, poReceiveEscalationMinTotal: true },
      });
      qcInbound = !!w?.qcInboundEnabled;
      qcWarehouseId = w ? w.id : null;
      whForEscalation = w;
    }

    for (const line of grn.lines) {
      const variantRow = await tx.productVariant.findUnique({
        where: { id: line.variantId },
        select: { requiresExpiry: true, requiresMfg: true },
      });
      if (!variantRow) throw new Error(`Variant ${line.variantId} not found`);
      if (variantRow.requiresExpiry && !line.expDate) {
        throw new Error(`expDate is required for expiry-tracked variant ${line.variantId}`);
      }
      if (variantRow.requiresMfg && !line.mfgDate) {
        throw new Error(`mfgDate is required for variant ${line.variantId}`);
      }

      let lotId: number | null = null;
      if (line.lotId) {
        const lot = await tx.stockLot.findUnique({ where: { id: line.lotId } });
        if (!lot || lot.variantId !== line.variantId) throw new Error(`Invalid lotId for line variant ${line.variantId}`);
        lotId = lot.id;
      } else {
        const lotCode = (line.lotCode || `GRN-${grnId}-${line.id}`).trim();
        const mfgDate = line.mfgDate ? new Date(line.mfgDate) : new Date();
        const expDate = line.expDate
          ? new Date(line.expDate)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        if (new Date() >= expDate) throw new Error(`Lot expiry must be in the future for variant ${line.variantId}`);
        let lot = await tx.stockLot.findFirst({
          where: { orgId: org, variantId: line.variantId, lotCode },
        });
        if (!lot) {
          const sb =
            line.supplierBarcode != null && String(line.supplierBarcode).trim()
              ? String(line.supplierBarcode).trim().slice(0, 128)
              : null;
          lot = await tx.stockLot.create({
            data: {
              orgId: org,
              variantId: line.variantId,
              lotCode,
              mfgDate,
              expDate,
              supplierBarcode: sb,
              createdByUserId: userId,
            },
          });
        }
        lotId = lot.id;
        await tx.grnLine.update({
          where: { id: line.id },
          data: { lotId },
        });
      }

      const unitCost = line.unitCost != null ? Number(line.unitCost) : null;
      await ledgerService.recordLedgerEntryInTx(tx, {
        orgId: org,
        locationId: grn.locationId,
        variantId: line.variantId,
        lotId,
        type: "GRN_IN",
        quantityDelta: line.quantity,
        unitCost: unitCost ?? undefined,
        refType: "GRN",
        refId: String(grnId),
        createdByUserId: userId,
      });

      if (qcInbound && qcWarehouseId != null && lotId) {
        await tx.qcInspection.create({
          data: {
            orgId: org,
            warehouseId: qcWarehouseId,
            grnId,
            grnLineId: line.id,
            locationId: grn.locationId,
            variantId: line.variantId,
            lotId,
            expectedQty: line.quantity,
            status: "PENDING",
          },
        });
      }
    }

    await tx.grn.update({
      where: { id: grnId },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedByUserId: userId },
    });

    await logWarehouseAuditInTx(tx, {
      orgId,
      warehouseId: qcWarehouseId,
      category: "OPERATIONS",
      action: "GRN_POSTED",
      entityType: "GRN",
      entityId: String(grnId),
      metadata: { purchaseOrderId: grn.purchaseOrderId ?? null, vendorId: grn.vendorId ?? null },
      actorUserId: userId,
    });

    // Vendor ledger: record GRN event only when vendor is set
    if (grn.vendorId != null) {
      await tx.vendorLedgerEntry.create({
        data: {
          vendorId: grn.vendorId,
          orgId: grn.orgId,
          sourceType: "GRN",
          sourceId: `GRN-${grnId}|amount_pending`,
          debit: 0,
          credit: 0,
        },
      });
    }

    const inboundShip = require("../inbound_shipments/inboundShipment.service");
    await inboundShip.applyGrnLinesToInboundShipmentSnapshots(tx, grnId, orgId);

    const poId = grn.purchaseOrderId;
    if (poId != null) {
      await purchaseOrderHooks.applyGrnReceiveToPurchaseOrder(tx, grnId, poId, org);
      if (whForEscalation?.poReceiveEscalationMinTotal != null) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: { grandTotal: true },
        });
        const min = Number(whForEscalation.poReceiveEscalationMinTotal);
        const gt = po?.grandTotal != null ? Number(po.grandTotal) : null;
        if (gt != null && !Number.isNaN(min) && gt >= min) {
          await logWarehouseAuditInTx(tx, {
            orgId: org,
            warehouseId: qcWarehouseId,
            category: "ESCALATION",
            action: "PO_HIGH_VALUE_GRN_RECEIVE",
            entityType: "GRN",
            entityId: String(grnId),
            metadata: { purchaseOrderId: poId, grandTotal: gt, threshold: min },
            actorUserId: userId,
          });
        }
      }
    }
  });

  try {
    const { enqueuePutawayTasksAfterGrnReceive } = require("../putaway/putawayTask.service");
    await enqueuePutawayTasksAfterGrnReceive(grnId, orgId);
  } catch (e) {
    console.error("enqueuePutawayTasksAfterGrnReceive", e);
  }

  import("../network_balance/networkBalance.service")
    .then(({ recomputeNetworkBalance }) =>
      recomputeNetworkBalance({ orgId, userId }).catch((e) => console.error("recomputeNetworkBalance after GRN", e))
    )
    .catch(() => {});

  return getGrnById(grnId, orgId);
}

/** Void a draft GRN (no stock posted). */
export async function voidDraftGrn(grnId: number, orgId: number, userId: number, reason?: string | null) {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: {
      id: true,
      status: true,
      purchaseOrderId: true,
      locationId: true,
      location: { select: { warehouseId: true } },
    },
  });
  if (!grn) throw new Error("GRN not found");
  if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRNs can be voided");

  await prisma.grn.update({
    where: { id: grnId },
    data: {
      status: "VOIDED",
      voidedAt: new Date(),
      voidReason: reason ?? null,
      voidedByUserId: userId,
    },
  });

  let whId: number | null = grn.location?.warehouseId ?? null;
  if (whId == null && grn.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: grn.purchaseOrderId },
      select: { warehouseId: true },
    });
    if (po?.warehouseId != null) whId = po.warehouseId;
  }

  await logWarehouseAudit({
    orgId,
    warehouseId: whId,
    category: "OPERATIONS",
    action: "GRN_VOIDED",
    entityType: "GRN",
    entityId: String(grnId),
    metadata: { reason: reason ?? null },
    actorUserId: userId,
  });

  return getGrnById(grnId, orgId);
}

export type BulkReceiveLineError = { rowIndex: number; message: string };

/**
 * Validate bulk receive lines: quantity > 0, variant exists in org, requiresLot/requiresExpiry/requiresMfg, exp > mfg, exp in future.
 */
export async function validateBulkReceiveLines(
  orgId: number,
  lines: Array<{ variantId: number; quantity: number; lotCode?: string; mfgDate?: string; expDate?: string }>
): Promise<BulkReceiveLineError[]> {
  const errors: BulkReceiveLineError[] = [];
  if (!lines?.length) return [{ rowIndex: 0, message: "At least one line is required" }];
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { orgId } },
    select: { id: true, requiresLot: true, requiresExpiry: true, requiresMfg: true },
  });
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const now = new Date();
  lines.forEach((line, rowIndex) => {
    if (line.quantity == null || Number(line.quantity) <= 0) {
      errors.push({ rowIndex, message: "Quantity must be greater than 0" });
      return;
    }
    const variant = variantMap.get(line.variantId);
    if (!variant) {
      errors.push({ rowIndex, message: `Variant ${line.variantId} not found or not in organization` });
      return;
    }
    if (variant.requiresLot && !(line.lotCode != null && String(line.lotCode).trim())) {
      errors.push({ rowIndex, message: "Lot code is required for this variant" });
    }
    if (variant.requiresExpiry) {
      if (!line.expDate) errors.push({ rowIndex, message: "Expiry date is required for this variant" });
      else {
        const exp = new Date(line.expDate);
        if (exp <= now) errors.push({ rowIndex, message: "Expiry date must be in the future" });
      }
    }
    if (variant.requiresMfg && !line.mfgDate) {
      errors.push({ rowIndex, message: "Manufacturing date is required for this variant" });
    }
    if (line.expDate && line.mfgDate) {
      const exp = new Date(line.expDate);
      const mfg = new Date(line.mfgDate);
      if (exp <= mfg) errors.push({ rowIndex, message: "Expiry date must be after manufacturing date" });
    }
  });
  return errors;
}

/**
 * Create GRN and receive in one atomic flow (bulk purchase receive).
 * Enterprise: POST /inventory/receipts/bulk
 * Validates lines before create; throws with code BULK_RECEIVE_VALIDATION and errors array if validation fails.
 */
export async function createAndReceiveGrn(data: CreateGrnInput, userId: number) {
  const idemKey =
    data.receiveIdempotencyKey != null && String(data.receiveIdempotencyKey).trim()
      ? String(data.receiveIdempotencyKey).trim().slice(0, 64)
      : null;
  if (idemKey) {
    const existing = await prisma.grn.findFirst({
      where: { orgId: data.orgId, receiveIdempotencyKey: idemKey },
    });
    if (existing?.status === "RECEIVED") {
      return getGrnById(existing.id, data.orgId);
    }
    if (existing?.status === "VOIDED") {
      throw new Error("receiveIdempotencyKey refers to a voided GRN");
    }
    if (existing?.status === "DRAFT") {
      const validationErrors = await validateBulkReceiveLines(data.orgId, data.lines);
      if (validationErrors.length > 0) {
        const err = new Error("Bulk receive validation failed");
        (err as any).code = "BULK_RECEIVE_VALIDATION";
        (err as any).errors = validationErrors;
        throw err;
      }
      return receiveGrn(existing.id, data.orgId, userId);
    }
  }

  const validationErrors = await validateBulkReceiveLines(data.orgId, data.lines);
  if (validationErrors.length > 0) {
    const err = new Error("Bulk receive validation failed");
    (err as any).code = "BULK_RECEIVE_VALIDATION";
    (err as any).errors = validationErrors;
    throw err;
  }
  const grn = await createGrn(data);
  return receiveGrn(grn.id, data.orgId, userId);
}
