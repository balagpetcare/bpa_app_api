import prisma from "../../../../infrastructure/db/prismaClient";
import type { StockReturnDisposition, StockReturnReason } from "@prisma/client";

const FINAL_DISPOSITIONS: StockReturnDisposition[] = [
  "RESTOCK_SELLABLE",
  "RESTOCK_QUARANTINE",
  "RETURN_TO_VENDOR",
  "DESTROY",
  "REWORK",
];

function appendAudit(meta: Record<string, unknown>, entry: Record<string, unknown>) {
  const trail = Array.isArray(meta.auditTrail) ? [...(meta.auditTrail as unknown[])] : [];
  trail.push({ at: new Date().toISOString(), ...entry });
  meta.auditTrail = trail;
}

async function assertInventoryLocationsInOrg(orgId: number, locationIds: number[]) {
  const uniq = [...new Set(locationIds.filter((x) => Number.isFinite(x) && x > 0))];
  if (uniq.length !== locationIds.length) throw new Error("Invalid location");
  const locs = await prisma.inventoryLocation.findMany({
    where: { id: { in: uniq } },
    select: { id: true, branch: { select: { orgId: true } } },
  });
  if (locs.length !== uniq.length) throw new Error("Location not found");
  for (const l of locs) {
    if (l.branch.orgId !== orgId) throw new Error("Location does not belong to organization");
  }
}

async function assertReturnItemsBelongToOrg(
  orgId: number,
  items: Array<{ variantId: number; lotId?: number; quantityReturned: number }>
) {
  for (const i of items) {
    if (!Number.isFinite(i.quantityReturned) || i.quantityReturned <= 0) {
      throw new Error("Each line must have quantityReturned > 0");
    }
  }
  const variantIds = [...new Set(items.map((x) => x.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product: { select: { orgId: true } } },
  });
  if (variants.length !== variantIds.length) throw new Error("Invalid variant");
  for (const v of variants) {
    if (v.product.orgId !== orgId) throw new Error("Variant does not belong to organization");
  }
  for (const i of items) {
    if (i.lotId == null) continue;
    const lot = await prisma.stockLot.findFirst({
      where: { id: i.lotId },
      select: { id: true, orgId: true, variantId: true },
    });
    if (!lot) throw new Error("Invalid lot");
    if (lot.orgId !== orgId) throw new Error("Lot does not belong to organization");
    if (lot.variantId !== i.variantId) throw new Error("Lot does not match variant");
  }
}

export async function createStockReturn(params: {
  orgId: number;
  fromLocationId: number;
  toLocationId: number;
  reason: StockReturnReason;
  userId: number;
  items: Array<{ variantId: number; lotId?: number; quantityReturned: number }>;
  note?: string;
}) {
  if (!params.items?.length) throw new Error("At least one line item required");
  if (params.fromLocationId === params.toLocationId) throw new Error("From and to locations must differ");
  await assertInventoryLocationsInOrg(params.orgId, [params.fromLocationId, params.toLocationId]);
  await assertReturnItemsBelongToOrg(params.orgId, params.items);

  return prisma.stockReturn.create({
    data: {
      orgId: params.orgId,
      fromLocationId: params.fromLocationId,
      toLocationId: params.toLocationId,
      reason: params.reason,
      status: "CREATED",
      createdByUserId: params.userId,
      note: params.note ?? null,
      disposition: "PENDING",
      items: {
        create: params.items.map((i) => ({
          variantId: i.variantId,
          lotId: i.lotId ?? null,
          quantityReturned: i.quantityReturned,
        })),
      },
    },
    include: {
      items: { include: { variant: true, lot: true } },
      fromLocation: true,
      toLocation: true,
    },
  });
}

export async function assertOrg(userId: number, orgId: number) {
  const owner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId }, select: { id: true } });
  if (owner) return;
  const m = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" } });
  if (!m) throw new Error("Forbidden: org access");
}

export async function listStockReturns(orgId: number, opts: { status?: string; page?: number; limit?: number }) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 100);
  const where: any = { orgId };
  if (opts.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.stockReturn.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        fromLocation: { select: { id: true, name: true, type: true, branchId: true } },
        toLocation: { select: { id: true, name: true, type: true, branchId: true } },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true } },
          },
        },
      },
    }),
    prisma.stockReturn.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getStockReturn(orgId: number, id: number) {
  return prisma.stockReturn.findFirst({
    where: { id, orgId },
    include: {
      fromLocation: { select: { id: true, name: true, type: true, branch: { select: { name: true } } } },
      toLocation: { select: { id: true, name: true, type: true, branch: { select: { name: true } } } },
      linkedVendorReturn: { select: { id: true, status: true, vendorId: true } },
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true, product: { select: { name: true } } } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
        },
      },
    },
  });
}

export async function receiveStockReturn(params: {
  orgId: number;
  id: number;
  userId: number;
  lines: Array<{ itemId: number; quantityReceived: number }>;
}) {
  const sr = await prisma.stockReturn.findFirst({
    where: { id: params.id, orgId: params.orgId },
    include: { items: true },
  });
  if (!sr) throw new Error("Stock return not found");
  if (sr.status === "CANCELLED") throw new Error("Cannot receive cancelled return");
  if (sr.status !== "CREATED" && sr.status !== "IN_TRANSIT") {
    throw new Error("Return is not in a receivable status");
  }

  const itemById = new Map(sr.items.map((i) => [i.id, i]));
  for (const ln of params.lines) {
    const row = itemById.get(ln.itemId);
    if (!row) throw new Error(`Invalid line item ${ln.itemId}`);
    if (!Number.isFinite(ln.quantityReceived) || ln.quantityReceived < 0) {
      throw new Error("quantityReceived must be >= 0");
    }
    if (ln.quantityReceived > row.quantityReturned) {
      throw new Error(`quantityReceived exceeds quantityReturned for item ${ln.itemId}`);
    }
  }

  const baseMeta =
    typeof sr.metaJson === "object" && sr.metaJson ? ({ ...(sr.metaJson as object) } as Record<string, unknown>) : {};
  appendAudit(baseMeta, { action: "RECEIVE", userId: params.userId, lineCount: params.lines.length });

  await prisma.$transaction(async (tx) => {
    for (const ln of params.lines) {
      await tx.stockReturnItem.updateMany({
        where: { id: ln.itemId, stockReturnId: sr.id },
        data: { quantityReceived: ln.quantityReceived },
      });
    }
  });

  return prisma.stockReturn.update({
    where: { id: sr.id },
    data: {
      status: "RECEIVED",
      receivedAt: new Date(),
      receivedByUserId: params.userId,
      disposition: "PENDING",
      metaJson: baseMeta as any,
    },
    include: {
      items: { include: { variant: true, lot: true } },
      fromLocation: true,
      toLocation: true,
    },
  });
}

export async function setDisposition(params: {
  orgId: number;
  id: number;
  disposition: StockReturnDisposition;
  linkedVendorReturnId?: number | null;
  metaPatch?: object;
  userId?: number;
}) {
  const sr = await prisma.stockReturn.findFirst({ where: { id: params.id, orgId: params.orgId } });
  if (!sr) throw new Error("Stock return not found");
  if (sr.status === "CANCELLED") throw new Error("Cannot change disposition on cancelled return");
  if (params.disposition === "DISPUTED") {
    throw new Error("Use the dispute endpoint to mark a return as disputed");
  }
  if (FINAL_DISPOSITIONS.includes(params.disposition) && sr.status !== "RECEIVED") {
    throw new Error("Final disposition requires status RECEIVED");
  }
  if (params.linkedVendorReturnId != null) {
    const vr = await prisma.vendorReturn.findFirst({
      where: { id: params.linkedVendorReturnId, orgId: params.orgId },
      select: { id: true },
    });
    if (!vr) throw new Error("Vendor return not found for this organization");
  }

  const meta: Record<string, unknown> = {
    ...(typeof sr.metaJson === "object" && sr.metaJson ? (sr.metaJson as object) : {}),
    ...(params.metaPatch || {}),
  };
  appendAudit(meta, {
    action: "DISPOSITION",
    userId: params.userId ?? null,
    disposition: params.disposition,
    linkedVendorReturnId: params.linkedVendorReturnId ?? null,
  });

  return prisma.stockReturn.update({
    where: { id: sr.id },
    data: {
      disposition: params.disposition,
      linkedVendorReturnId: params.linkedVendorReturnId ?? undefined,
      metaJson: meta as any,
    },
    include: { items: true, fromLocation: true, toLocation: true },
  });
}

export async function openDispute(orgId: number, id: number, note?: string, userId?: number) {
  const sr = await prisma.stockReturn.findFirst({ where: { id, orgId } });
  if (!sr) throw new Error("Stock return not found");
  if (sr.status === "CANCELLED") throw new Error("Cannot dispute cancelled return");

  const meta: Record<string, unknown> = {
    ...(typeof sr.metaJson === "object" && sr.metaJson ? (sr.metaJson as object) : {}),
    disputeNote: note ?? null,
    disputedAt: new Date().toISOString(),
  };
  appendAudit(meta, { action: "DISPUTE", userId: userId ?? null, note: note ?? null });

  return prisma.stockReturn.update({
    where: { id },
    data: {
      disposition: "DISPUTED",
      disputedAt: new Date(),
      metaJson: meta as any,
    },
  });
}

export async function listCases(orgId: number) {
  return prisma.reverseLogisticsCase.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createCase(params: {
  orgId: number;
  caseType: "CUSTOMER" | "BRANCH_TO_DC" | "DC_TO_VENDOR" | "RECALL_RELATED";
  primaryEntityType: string;
  primaryEntityId: number;
  metaJson?: object;
  createdByUserId?: number;
}) {
  return prisma.reverseLogisticsCase.create({
    data: {
      orgId: params.orgId,
      caseType: params.caseType,
      primaryEntityType: params.primaryEntityType,
      primaryEntityId: params.primaryEntityId,
      metaJson: params.metaJson as any,
      createdByUserId: params.createdByUserId,
    },
  });
}
