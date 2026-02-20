/**
 * GRN (Goods Received Note) service.
 * Receive creates StockLot when needed and writes StockLedger GRN_IN (single source of truth).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");

export type CreateGrnInput = {
  orgId: number;
  vendorId?: number | null;
  locationId: number;
  invoiceNo?: string;
  invoiceDate?: string;
  notes?: string;
  lines: Array<{
    variantId: number;
    quantity: number;
    unitCost?: number;
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
  const vendorId = data.vendorId != null ? data.vendorId : null;
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
      locationId: data.locationId,
      status: "DRAFT",
      invoiceNo: data.invoiceNo ?? null,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
      notes: data.notes ?? null,
      lines: {
        create: data.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitCost: l.unitCost != null ? l.unitCost : null,
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

export async function updateGrn(grnId: number, orgId: number, data: { notes?: string; invoiceNo?: string; invoiceDate?: string; lines?: Array<{ variantId: number; quantity: number; unitCost?: number; lotCode?: string; mfgDate?: string; expDate?: string }> }) {
  const existing = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    select: { status: true },
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
    await prisma.$transaction(async (tx: any) => {
      await tx.grnLine.deleteMany({ where: { grnId } });
      if (data.lines!.length) {
        await tx.grnLine.createMany({
          data: data.lines!.map((l) => ({
            grnId,
            variantId: l.variantId,
            quantity: l.quantity,
            unitCost: l.unitCost != null ? l.unitCost : null,
            lotCode: l.lotCode ?? null,
            mfgDate: l.mfgDate ? new Date(l.mfgDate) : null,
            expDate: l.expDate ? new Date(l.expDate) : null,
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
    }

    await tx.grn.update({
      where: { id: grnId },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedByUserId: userId },
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
