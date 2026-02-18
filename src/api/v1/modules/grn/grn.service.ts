/**
 * GRN (Goods Received Note) service.
 * Receive creates StockLot when needed and writes StockLedger GRN_IN (single source of truth).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");

export type CreateGrnInput = {
  orgId: number;
  vendorId: number;
  locationId: number;
  notes?: string;
  lines: Array<{
    variantId: number;
    quantity: number;
    lotCode?: string;
    mfgDate?: string;
    expDate?: string;
  }>;
};

export type ListGrnFilter = {
  orgId: number;
  locationId?: number;
  vendorId?: number;
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
  const vendor = await prisma.vendor.findFirst({
    where: { id: data.vendorId, orgId: data.orgId },
  });
  if (!vendor) throw new Error("Vendor not found or does not belong to organization");

  const grn = await prisma.grn.create({
    data: {
      orgId: data.orgId,
      vendorId: data.vendorId,
      locationId: data.locationId,
      status: "DRAFT",
      notes: data.notes ?? null,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          lotCode: l.lotCode ?? null,
          mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
          expDate: l.expDate ? new Date(l.expDate) : null,
        })),
      },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
    },
  });
  return grn;
}

export async function listGrns(filter: ListGrnFilter) {
  const page = filter.page ?? 1;
  const limit = Math.min(filter.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = { orgId: filter.orgId };
  if (filter.locationId) where.locationId = filter.locationId;
  if (filter.vendorId) where.vendorId = filter.vendorId;
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
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true, productId: true } },
        },
      },
    },
  });
  return grn;
}

export async function updateGrn(grnId: number, orgId: number, data: { notes?: string; lines?: Array<{ variantId: number; quantity: number; lotCode?: string; mfgDate?: string; expDate?: string }> }) {
  const existing = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: { status: true },
  });
  if (!existing) throw new Error("GRN not found");
  if (existing.status !== "DRAFT") throw new Error("Only DRAFT GRN can be updated");

  const updateData: any = {};
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.lines !== undefined) {
    await prisma.$transaction(async (tx: any) => {
      await tx.grnLine.deleteMany({ where: { grnId } });
      if (data.lines!.length) {
        await tx.grnLine.createMany({
          data: data.lines!.map((l) => ({
            grnId,
            variantId: l.variantId,
            quantity: l.quantity,
            lotCode: l.lotCode ?? null,
            mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
            expDate: l.expDate ? new Date(l.expDate) : null,
          })),
        });
      }
    });
  }
  if (Object.keys(updateData).length) {
    await prisma.grn.update({
      where: { id: grnId },
      data: updateData,
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
  if (grn.status !== "DRAFT") throw new Error("Only DRAFT GRN can be received");

  const org = grn.location.branch.orgId;

  await prisma.$transaction(async (tx: any) => {
    for (const line of grn.lines) {
      let lotId: number | null = null;
      if (line.lotId) {
        const lot = await tx.stockLot.findUnique({ where: { id: line.lotId } });
        if (!lot || lot.variantId !== line.variantId) throw new Error(`Invalid lotId for line variant ${line.variantId}`);
        lotId = lot.id;
      } else {
        const lotCode = (line.lotCode || `GRN-${grnId}-${line.id}`).trim();
        const mfgDate = line.mfgDate || new Date();
        const expDate = line.expDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        if (new Date() >= expDate) throw new Error(`Lot expiry must be in the future for variant ${line.variantId}`);
        let lot = await tx.stockLot.findFirst({
          where: { orgId: org, variantId: line.variantId, lotCode },
        });
        if (!lot) {
          lot = await tx.stockLot.create({
            data: {
              orgId: org,
              variantId: line.variantId,
              lotCode,
              mfgDate,
              expDate,
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

      await ledgerService.recordLedgerEntryInTx(tx, {
        locationId: grn.locationId,
        variantId: line.variantId,
        lotId,
        type: "GRN_IN",
        quantityDelta: line.quantity,
        refType: "GRN",
        refId: String(grnId),
        createdByUserId: userId,
      });
    }

    await tx.grn.update({
      where: { id: grnId },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedByUserId: userId },
    });
  });

  return getGrnById(grnId, orgId);
}
