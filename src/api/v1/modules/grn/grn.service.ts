/**
 * GRN (Goods Received Note) service.
 * Receive creates StockLot when needed and writes StockLedger GRN_IN (single source of truth).
 */
import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");
import { logWarehouseAuditInTx, logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { assertVariantsBelongToOrg } from "../_shared/variantOrgValidation";

const purchaseOrderHooks = require("../purchase_orders/purchaseOrder.service");

async function syncInboundDiscrepanciesFromGrnLines(tx: Prisma.TransactionClient, orgId: number, grnId: number) {
  await tx.inboundDiscrepancy.deleteMany({
    where: { grnId, status: "OPEN" },
  });
  const lines = await tx.grnLine.findMany({ where: { grnId } });
  for (const line of lines) {
    const noteFromLine =
      line.lineDiscrepancyNote != null && String(line.lineDiscrepancyNote).trim()
        ? String(line.lineDiscrepancyNote).trim()
        : line.lineRemarks != null && String(line.lineRemarks).trim()
          ? String(line.lineRemarks).trim()
          : null;
    const base = {
      orgId,
      grnId,
      grnLineId: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
      variantId: line.variantId,
      notes: noteFromLine,
    };
    if (line.quantityDamaged > 0) {
      await tx.inboundDiscrepancy.create({
        data: {
          ...base,
          discrepancyType: "DAMAGED",
          quantity: line.quantityDamaged,
        },
      });
    }
    if (line.quantityShort > 0) {
      await tx.inboundDiscrepancy.create({
        data: {
          ...base,
          discrepancyType: "SHORT",
          quantity: line.quantityShort,
        },
      });
    }
    if (line.quantityExtra > 0) {
      await tx.inboundDiscrepancy.create({
        data: {
          ...base,
          discrepancyType: "EXTRA",
          quantity: line.quantityExtra,
        },
      });
    }
  }
}

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
  quantityExtra?: number;
  lineDiscrepancyNote?: string;
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
  /** Actor creating the draft (vendor receive session). */
  createdByUserId?: number | null;
  lines: CreateGrnLineInput[];
};

/** Vendor/PO/inbound-shipment GRNs (not transfer receive) use VendorReceiveSession before ledger post. */
export function isControlledVendorInboundGrn(grn: {
  stockDispatchId: number | null;
  vendorId: number | null;
  purchaseOrderId: number | null;
  inboundShipmentId: number | null;
}) {
  if (grn.stockDispatchId != null) return false;
  return !!(grn.vendorId || grn.purchaseOrderId || grn.inboundShipmentId);
}

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
  /** Filter by VendorReceiveSession status (e.g. AWAITING_CONFIRMATION). */
  sessionStatus?: string;
  /** Restrict to GRNs whose receiving location belongs to this branch (warehouse branch context). */
  branchId?: number;
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
  if (member) return [member.orgId];
  /** Branch-only staff (e.g. WAREHOUSE_MANAGER) may have no OrgMember but have BranchMember rows. */
  const branchMemberships = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
    distinct: ["orgId"],
  });
  const fromBranch = [...new Set(branchMemberships.map((b) => b.orgId))];
  return fromBranch;
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
          quantityExtra: l.quantityExtra != null ? Math.max(0, Math.floor(l.quantityExtra)) : 0,
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
          lineDiscrepancyNote:
            l.lineDiscrepancyNote != null && String(l.lineDiscrepancyNote).trim()
              ? String(l.lineDiscrepancyNote).trim().slice(0, 500)
              : null,
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
    actorUserId: data.createdByUserId ?? null,
  });

  if (isControlledVendorInboundGrn(grn)) {
    await prisma.vendorReceiveSession.create({
      data: {
        orgId: data.orgId,
        grnId: grn.id,
        status: "DRAFT",
        createdByUserId: data.createdByUserId ?? null,
      },
    });
    await logWarehouseAudit({
      orgId: data.orgId,
      warehouseId: locWh?.warehouseId ?? null,
      category: "OPERATIONS",
      action: "VENDOR_RECEIVE_SESSION_CREATED",
      entityType: "VendorReceiveSession",
      entityId: String(grn.id),
      metadata: { grnId: grn.id },
      actorUserId: data.createdByUserId ?? null,
    });
  }

  return getGrnById(grn.id, data.orgId);
}

export async function listGrns(filter: ListGrnFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = { orgId: filter.orgId };
  if (filter.branchId != null) {
    const locs = await prisma.inventoryLocation.findMany({
      where: {
        branchId: filter.branchId,
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
  } else if (filter.warehouseId != null) {
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
  if (filter.sessionStatus) {
    where.vendorReceiveSession = { status: filter.sessionStatus };
  }
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
        location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            purchaseOrderLine: { select: { orderedQty: true } },
          },
        },
        vendorReceiveSession: {
          select: { id: true, status: true, submittedAt: true, confirmedAt: true },
        },
      },
    }),
    prisma.grn.count({ where }),
  ]);

  const itemsWithTotals = items.map((row: any) => {
    const lines = Array.isArray(row.lines) ? row.lines : [];
    const totalQty = lines.reduce((s: number, l: { quantity?: unknown }) => s + Number(l.quantity ?? 0), 0);
    return { ...row, totalQty };
  });

  return {
    items: itemsWithTotals,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Pending vendor receive counts for sidebar / dashboard (scoped to branch locations). */
export async function getPendingVendorReceiveCountsForBranch(orgId: number, branchId: number) {
  const branchOk = await prisma.branch.findFirst({
    where: { id: branchId, orgId },
    select: { id: true },
  });
  if (!branchOk) {
    throw new Error("Branch not found for this organization");
  }
  const locs = await prisma.inventoryLocation.findMany({
    where: { branchId, isActive: true, branch: { orgId } },
    select: { id: true },
  });
  const locationIds = locs.map((l) => l.id);
  if (!locationIds.length) {
    return { awaitingConfirmation: 0, draftVendorReceives: 0 };
  }

  const baseWhere = { orgId, status: "DRAFT" as const, locationId: { in: locationIds } };

  const [awaitingConfirmation, draftVendorReceives] = await Promise.all([
    prisma.grn.count({
      where: {
        ...baseWhere,
        vendorReceiveSession: { status: "AWAITING_CONFIRMATION" },
      },
    }),
    prisma.grn.count({
      where: {
        ...baseWhere,
        vendorReceiveSession: { status: "DRAFT" },
      },
    }),
  ]);

  return { awaitingConfirmation, draftVendorReceives };
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
      vendorReceiveSession: {
        select: {
          id: true,
          status: true,
          submittedAt: true,
          submittedByUserId: true,
          confirmedAt: true,
          confirmedByUserId: true,
          createdAt: true,
          updatedAt: true,
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
            quantityExtra: l.quantityExtra != null ? Math.max(0, Math.floor(l.quantityExtra)) : 0,
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
            lineDiscrepancyNote:
              l.lineDiscrepancyNote != null && String(l.lineDiscrepancyNote).trim()
                ? String(l.lineDiscrepancyNote).trim().slice(0, 500)
                : null,
          })),
        });
      }
    });
  }
  return getGrnById(grnId, orgId);
}

export type ManagerConfirmLineInput = {
  lineId: number;
  acceptedQty: number;
  damagedQty: number;
  /** If omitted, derived from PO ordered − accepted − damaged when a PO line exists; else 0 */
  shortQty?: number | null;
  extraQty: number;
  lot?: string | null;
  expiry?: string | null;
  note?: string | null;
};

function parseManagerConfirmLine(raw: Record<string, unknown>): ManagerConfirmLineInput {
  const lineId = Number(raw.lineId);
  const acceptedQty = Math.floor(Number(raw.acceptedQty ?? raw.quantity ?? 0));
  const damagedQty = Math.floor(Number(raw.damagedQty ?? raw.quantityDamaged ?? 0));
  const rawShort = raw.shortQty ?? raw.quantityShort;
  const shortQty =
    rawShort === undefined || rawShort === null || rawShort === ""
      ? null
      : Math.floor(Number(rawShort));
  const extraQty = Math.floor(Number(raw.extraQty ?? raw.quantityExtra ?? 0));
  const lot =
    raw.lot != null && String(raw.lot).trim()
      ? String(raw.lot).trim()
      : raw.lotCode != null && String(raw.lotCode).trim()
        ? String(raw.lotCode).trim()
        : null;
  const expiry =
    raw.expiry != null && String(raw.expiry).trim()
      ? String(raw.expiry).trim()
      : raw.expDate != null && String(raw.expDate).trim()
        ? String(raw.expDate).trim()
        : null;
  const note =
    raw.note != null && String(raw.note).trim()
      ? String(raw.note).trim()
      : raw.lineDiscrepancyNote != null && String(raw.lineDiscrepancyNote).trim()
        ? String(raw.lineDiscrepancyNote).trim()
        : null;
  return { lineId, acceptedQty, damagedQty, shortQty, extraQty, lot, expiry, note };
}

/**
 * Warehouse manager: adjust GRN lines in place before confirm/post (stable line ids).
 * Validates quantities, PO caps, and expiry rules; clears lotId so receiveGrn resolves lot from code/dates.
 */
export type ApplyManagerConfirmLineEditsOptions = {
  /** When true, skip the "at least one accepted+extra" check (draft save before final post). */
  allowZeroTotalStock?: boolean;
};

export async function applyManagerConfirmLineEdits(
  grnId: number,
  orgId: number,
  rawLines: Array<Record<string, unknown>>,
  options?: ApplyManagerConfirmLineEditsOptions
) {
  const allowZeroTotalStock = options?.allowZeroTotalStock === true;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error("lines[] is required for manager confirmation edits");
  }
  const inputs = rawLines.map((r) => parseManagerConfirmLine(r));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw(Prisma.sql`SELECT id FROM grns WHERE id = ${grnId} FOR UPDATE`);

    const grn = await tx.grn.findFirst({
      where: { id: grnId, orgId },
      include: {
        lines: true,
        vendorReceiveSession: true,
      },
    });
    if (!grn) throw new Error("GRN not found");
    if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRN can be updated before posting");

    const inboundControlled = isControlledVendorInboundGrn(grn);
    if (inboundControlled) {
      const sess = grn.vendorReceiveSession;
      if (!sess) throw new Error("Vendor receive session is missing for this GRN");
      if (sess.status === "POSTED") throw new Error("This GRN has already been posted");
      if (sess.status === "CANCELLED") throw new Error("Vendor receive session was cancelled");
      if (sess.status !== "AWAITING_CONFIRMATION" && sess.status !== "DRAFT") {
        throw new Error(`Vendor receive session cannot be edited in status ${sess.status}`);
      }
    }

    const byId = new Map(grn.lines.map((l) => [l.id, l]));
    if (inputs.length !== grn.lines.length) {
      throw new Error("You must submit exactly one entry per GRN line");
    }
    const seen = new Set<number>();
    for (const p of inputs) {
      if (!Number.isFinite(p.lineId) || p.lineId <= 0) throw new Error("Invalid lineId");
      if (seen.has(p.lineId)) throw new Error(`Duplicate lineId ${p.lineId}`);
      seen.add(p.lineId);
      if (!byId.has(p.lineId)) throw new Error(`GRN line ${p.lineId} not found on this GRN`);
    }

    const po =
      grn.purchaseOrderId != null
        ? await tx.purchaseOrder.findFirst({
            where: { id: grn.purchaseOrderId, orgId },
            include: { lines: true },
          })
        : null;
    if (grn.purchaseOrderId != null && !po) throw new Error("Purchase order not found");

    type Prepared = {
      input: ManagerConfirmLineInput;
      row: (typeof grn.lines)[0];
      accepted: number;
      damaged: number;
      short: number;
      extra: number;
      pol: { id: number; orderedQty: number } | null;
    };

    const prepared: Prepared[] = [];

    for (const p of inputs) {
      const row = byId.get(p.lineId)!;
      let pol: any = null;
      if (po) {
        let polId = row.purchaseOrderLineId;
        if (polId == null) {
          polId = resolvePurchaseOrderLineId(po, {
            variantId: row.variantId,
            quantity: p.acceptedQty,
            purchaseOrderLineId: null,
          });
        }
        pol = po.lines.find((l: { id: number }) => l.id === polId) ?? null;
        if (!pol) throw new Error(`Purchase order line not found for GRN line ${row.id}`);
      }

      if (p.acceptedQty < 0 || p.damagedQty < 0 || p.extraQty < 0) {
        throw new Error(`Line ${p.lineId}: negative quantities are not allowed`);
      }

      let short = p.shortQty;
      if (short == null) {
        if (pol) {
          short = Math.max(0, pol.orderedQty - p.acceptedQty - p.damagedQty);
        } else {
          short = 0;
        }
      }
      if (short < 0 || !Number.isFinite(short)) throw new Error(`Line ${p.lineId}: invalid short quantity`);

      prepared.push({
        input: p,
        row,
        accepted: p.acceptedQty,
        damaged: p.damagedQty,
        short,
        extra: p.extraQty,
        pol,
      });
    }

    if (!allowZeroTotalStock) {
      const totalStock = prepared.reduce((s, x) => s + x.accepted + x.extra, 0);
      if (totalStock <= 0) {
        throw new Error("Cannot post stock: at least one line must have accepted or extra quantity");
      }

      for (const x of prepared) {
        const expectedQty = x.pol ? x.pol.orderedQty : x.row.quantity;
        const lhs = x.accepted + x.damaged + x.short;
        const rhs = expectedQty + x.extra;
        if (lhs !== rhs) {
          throw new Error(
            `Line ${x.input.lineId}: reconciliation failed — accepted (${x.accepted}) + damaged (${x.damaged}) + short (${x.short}) = ${lhs}, but expected (${expectedQty}) + extra (${x.extra}) = ${rhs}. Adjust quantities so they balance.`
          );
        }
      }
    }

    if (po) {
      const forPo = prepared.map((x) => {
        const polId =
          x.row.purchaseOrderLineId ??
          resolvePurchaseOrderLineId(po, {
            variantId: x.row.variantId,
            quantity: x.accepted + x.extra,
            purchaseOrderLineId: null,
          });
        return {
          variantId: x.row.variantId,
          quantity: x.accepted + x.extra,
          purchaseOrderLineId: polId,
        };
      });
      await validatePoGrnLinesAgainstWarehouse(tx, {
        orgId,
        purchaseOrderId: grn.purchaseOrderId!,
        locationId: grn.locationId,
        lines: forPo,
      });
    }

    for (const x of prepared) {
      const v = await tx.productVariant.findUnique({
        where: { id: x.row.variantId },
        select: { requiresExpiry: true, requiresMfg: true },
      });
      if (!v) throw new Error(`Variant ${x.row.variantId} not found`);
      const expDate = x.input.expiry ? new Date(x.input.expiry) : x.row.expDate ? new Date(x.row.expDate) : null;
      if (v.requiresExpiry && (!expDate || isNaN(expDate.getTime()))) {
        throw new Error(`expiry is required for line ${x.input.lineId} (expiry-tracked variant)`);
      }
      if (v.requiresMfg && !x.row.mfgDate) {
        throw new Error(`mfgDate is required for line ${x.input.lineId} (manufacturing-tracked variant)`);
      }

      const lotCode =
        x.input.lot != null && x.input.lot.trim()
          ? x.input.lot.trim().slice(0, 128)
          : x.row.lotCode != null && String(x.row.lotCode).trim()
            ? String(x.row.lotCode).trim().slice(0, 128)
            : `GRN-${grnId}-${x.row.id}`;

      await tx.grnLine.update({
        where: { id: x.row.id },
        data: {
          quantity: x.accepted,
          quantityDamaged: x.damaged,
          quantityShort: x.short,
          quantityExtra: x.extra,
          lotCode,
          expDate: expDate && !isNaN(expDate.getTime()) ? expDate : null,
          lotId: null,
          lineDiscrepancyNote:
            x.input.note != null && x.input.note.trim()
              ? x.input.note.trim().slice(0, 500)
              : x.row.lineDiscrepancyNote,
        },
      });
    }
  });

  return getGrnById(grnId, orgId);
}

export async function submitVendorReceiveSessionForConfirmation(grnId: number, orgId: number, userId: number) {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: { vendorReceiveSession: true, location: { select: { warehouseId: true } } },
  });
  if (!grn) throw new Error("GRN not found");
  if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRN can be submitted for confirmation");
  if (!isControlledVendorInboundGrn(grn)) {
    throw new Error("Submit for confirmation applies only to vendor / PO / inbound shipment GRNs");
  }
  const sess = grn.vendorReceiveSession;
  if (!sess) {
    throw new Error("Vendor receive session not found for this GRN");
  }
  if (sess.status === "AWAITING_CONFIRMATION") {
    return getGrnById(grnId, orgId);
  }
  if (sess.status !== "DRAFT") {
    throw new Error(`Vendor receive session is not in DRAFT (current: ${sess.status})`);
  }
  await prisma.vendorReceiveSession.update({
    where: { grnId },
    data: {
      status: "AWAITING_CONFIRMATION",
      submittedAt: new Date(),
      submittedByUserId: userId,
    },
  });
  await logWarehouseAudit({
    orgId,
    warehouseId: grn.location?.warehouseId ?? null,
    category: "OPERATIONS",
    action: "VENDOR_RECEIVE_SUBMITTED_FOR_CONFIRMATION",
    entityType: "VendorReceiveSession",
    entityId: String(grnId),
    metadata: { grnId },
    actorUserId: userId,
  });
  try {
    const { notifyVendorReceiveSubmittedForConfirmation } = require("../../services/warehouseOpsNotifications.service");
    void notifyVendorReceiveSubmittedForConfirmation({ orgId, grnId, actorUserId: userId });
  } catch (_) {
    /* optional */
  }
  return getGrnById(grnId, orgId);
}

export type ReceiveGrnOptions = {
  /** When true, warehouse manager may post from DRAFT session without a separate submit (shortcut). */
  allowPostFromDraft?: boolean;
};

export async function receiveGrn(grnId: number, orgId: number, userId: number, options?: ReceiveGrnOptions) {
  const allowPostFromDraft = options?.allowPostFromDraft === true;
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      location: { include: { branch: true } },
      lines: true,
      vendorReceiveSession: true,
    },
  });
  if (!grn) throw new Error("GRN not found");
  if (grn.status === "VOIDED") throw new Error("GRN is voided");
  if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRN can be received");

  const org = grn.location.branch.orgId;
  if (org !== orgId) {
    throw new Error("GRN location does not match organization");
  }

  const inboundControlled = isControlledVendorInboundGrn(grn);
  if (inboundControlled) {
    const sess = grn.vendorReceiveSession;
    if (!sess) {
      await logWarehouseAudit({
        orgId,
        warehouseId: null,
        category: "OPERATIONS",
        action: "VENDOR_RECEIVE_SESSION_MISSING_AT_POST",
        entityType: "GRN",
        entityId: String(grnId),
        metadata: { grnId },
        actorUserId: userId,
      });
      throw new Error(
        "Vendor receive session is missing for this GRN. Use a new draft GRN or contact support to backfill the session."
      );
    }
    if (sess.status === "POSTED") throw new Error("This GRN has already been posted");
    if (sess.status === "CANCELLED") throw new Error("Vendor receive session was cancelled");
    if (sess.status === "DRAFT" && !allowPostFromDraft) {
      throw new Error(
        "Submit for warehouse manager confirmation first (POST /api/v1/grn/:id/vendor-receive/submit), or post with manager authority."
      );
    }
    if (sess.status === "AWAITING_CONFIRMATION" || (sess.status === "DRAFT" && allowPostFromDraft)) {
      // proceed
    } else {
      throw new Error(`Vendor receive session cannot be posted in status ${sess.status}`);
    }
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw(Prisma.sql`SELECT id FROM grns WHERE id = ${grnId} FOR UPDATE`);

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
      const extraQty = line.quantityExtra != null ? Number(line.quantityExtra) : 0;
      const qtyIn = Number(line.quantity) + (Number.isFinite(extraQty) ? extraQty : 0);
      await ledgerService.recordLedgerEntryInTx(tx, {
        orgId: org,
        locationId: grn.locationId,
        variantId: line.variantId,
        lotId,
        type: "GRN_IN",
        quantityDelta: qtyIn,
        unitCost: unitCost ?? undefined,
        refType: "GRN",
        refId: String(grnId),
        createdByUserId: userId,
      });

      try {
        const receiveLoc = await tx.inventoryLocation.findUnique({
          where: { id: grn.locationId },
          select: { branchId: true },
        });
        if (receiveLoc?.branchId && userId && lotId) {
          const vaccineBridge = require("../clinic/vaccineInventoryBridge.service");
          await vaccineBridge.mirrorVendorGrnLineToClinicalStock(tx, {
            orgId: org,
            branchId: receiveLoc.branchId,
            grnLineId: line.id,
            productVariantId: line.variantId,
            stockLotId: lotId,
            quantityReceived: qtyIn,
            unitCost: unitCost ?? undefined,
            actorUserId: userId,
          });
        }
      } catch (mirrorErr: any) {
        console.warn("[grn.clinicalMirror]", grnId, line.id, mirrorErr?.message || mirrorErr);
      }

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
            expectedQty: qtyIn,
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

      const procurementDemandSvc = require("../procurement_demand/procurementDemand.service");
      await procurementDemandSvc.syncProcurementDemandsFromPurchaseOrderLines(tx, { orgId: org, purchaseOrderId: poId });

      // Sync linked StockRequest status based on PO receiving progress
      const linkedRequests = await tx.stockRequest.findMany({
        where: { linkedPurchaseOrderId: poId, requestIntent: "PROCUREMENT" },
        select: { id: true, status: true },
      });
      if (linkedRequests.length > 0) {
        const refreshedPO = await tx.purchaseOrder.findFirst({
          where: { id: poId },
          include: { lines: { select: { orderedQty: true, receivedQty: true } } },
        });
        if (refreshedPO) {
          const allReceived = refreshedPO.lines.every((l: any) => l.receivedQty >= l.orderedQty);
          const anyReceived = refreshedPO.lines.some((l: any) => l.receivedQty > 0);
          let nextStatus: string | null = null;
          if (allReceived) nextStatus = "RECEIVED";
          else if (anyReceived) nextStatus = "PARTIALLY_RECEIVED";
          if (nextStatus) {
            for (const sr of linkedRequests) {
              if (!["CANCELLED", "RECEIVED", "CLOSED"].includes(sr.status)) {
                await tx.stockRequest.update({
                  where: { id: sr.id },
                  data: { status: nextStatus as any },
                });
              }
            }
          }
        }
      }

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

    if (inboundControlled) {
      await tx.vendorReceiveSession.update({
        where: { grnId },
        data: {
          status: "POSTED",
          confirmedAt: new Date(),
          confirmedByUserId: userId,
        },
      });
    }

    await syncInboundDiscrepanciesFromGrnLines(tx, orgId, grnId);
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

  try {
    const { scheduleProcurementDemandAutoDispatchAfterGrn } = require("../fulfillment/autoFulfillmentQueue.service");
    scheduleProcurementDemandAutoDispatchAfterGrn(grnId, orgId);
  } catch (e) {
    console.error("scheduleProcurementDemandAutoDispatchAfterGrn", e);
  }

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

  await prisma.$transaction(async (tx: any) => {
    await tx.grn.update({
      where: { id: grnId },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidReason: reason ?? null,
        voidedByUserId: userId,
      },
    });
    await tx.vendorReceiveSession.updateMany({
      where: { grnId, status: { in: ["DRAFT", "AWAITING_CONFIRMATION"] } },
      data: { status: "CANCELLED" },
    });
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
 * Bulk purchase receive: create draft GRN (+ vendor receive session), optionally submit + post in one flow.
 * Enterprise: POST /inventory/receipts/bulk — default `postImmediately: false` saves draft only.
 */
export async function createAndReceiveGrn(
  data: CreateGrnInput,
  userId: number,
  options?: { postImmediately?: boolean }
) {
  const postImmediately = options?.postImmediately === true;
  const idemKey =
    data.receiveIdempotencyKey != null && String(data.receiveIdempotencyKey).trim()
      ? String(data.receiveIdempotencyKey).trim().slice(0, 64)
      : null;
  const payload: CreateGrnInput = { ...data, createdByUserId: data.createdByUserId ?? userId };

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
      if (!postImmediately) {
        return getGrnById(existing.id, data.orgId);
      }
      await submitVendorReceiveSessionForConfirmation(existing.id, data.orgId, userId);
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
  const grn = await createGrn(payload);
  if (!postImmediately) {
    return grn;
  }
  await submitVendorReceiveSessionForConfirmation(grn.id, data.orgId, userId);
  return receiveGrn(grn.id, data.orgId, userId);
}
