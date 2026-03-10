/**
 * Clinical Item Stock: branch-level stock, batch, low-stock alerts.
 * Stock mutations (adjust, receive) go through ClinicalStockLedger for audit trail.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const {
  recordClinicalLedgerEntryStandalone,
} = require("./clinicalStockLedger.service");

/** Get or create branch stock row for item+variant */
async function getOrCreateBranchStock(
  branchId: number,
  itemId: number,
  variantId: number
) {
  let row = await prisma.branchItemStock.findUnique({
    where: {
      branchId_itemId_variantId: { branchId, itemId, variantId },
    },
    include: {
      item: { select: { name: true, itemCode: true } },
      variant: { select: { variantName: true, sku: true } },
    },
  });
  if (!row) {
    row = await prisma.branchItemStock.create({
      data: {
        branchId,
        itemId,
        variantId,
        currentQty: 0,
        reservedQty: 0,
        availableQty: 0,
      },
      include: {
        item: { select: { name: true, itemCode: true } },
        variant: { select: { variantName: true, sku: true } },
      },
    });
  }
  return row;
}

/** Get branch stock for an item (all variants) or all items */
export async function getBranchItemStock(options: {
  branchId: number;
  itemId?: number;
  variantId?: number;
}) {
  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.itemId != null) where.itemId = options.itemId;
  if (options.variantId != null) where.variantId = options.variantId;

  const rows = await prisma.branchItemStock.findMany({
    where,
    include: {
      item: { select: { id: true, name: true, itemCode: true, domainType: true } },
      variant: {
        select: { id: true, variantName: true, sku: true, unitLabel: true },
      },
    },
    orderBy: [{ itemId: "asc" }, { variantId: "asc" }],
  });
  return rows;
}

/** Upsert branch stock (set currentQty; availableQty = currentQty - reservedQty) */
export async function upsertBranchItemStock(
  branchId: number,
  itemId: number,
  variantId: number,
  data: {
    currentQty?: number;
    reservedQty?: number;
    reorderLevel?: number | null;
    maxLevel?: number | null;
    avgCost?: number | null;
    lastPurchaseCost?: number | null;
  }
) {
  const row = await getOrCreateBranchStock(branchId, itemId, variantId);
  const currentQty = data.currentQty ?? Number(row.currentQty);
  const reservedQty = data.reservedQty ?? Number(row.reservedQty);
  const availableQty = Math.max(0, currentQty - reservedQty);

  const updated = await prisma.branchItemStock.update({
    where: { id: row.id },
    data: {
      currentQty: new Decimal(currentQty),
      reservedQty: new Decimal(reservedQty),
      availableQty: new Decimal(availableQty),
      reorderLevel: data.reorderLevel !== undefined ? data.reorderLevel : undefined,
      maxLevel: data.maxLevel !== undefined ? data.maxLevel : undefined,
      avgCost: data.avgCost !== undefined ? data.avgCost : undefined,
      lastPurchaseCost:
        data.lastPurchaseCost !== undefined ? data.lastPurchaseCost : undefined,
    },
    include: {
      item: { select: { name: true, itemCode: true } },
      variant: { select: { variantName: true } },
    },
  });
  return updated;
}

/** Adjust stock (delta: positive = add, negative = deduct). Writes through ClinicalStockLedger when actorId is provided. */
export async function adjustBranchItemStock(
  branchId: number,
  itemId: number,
  variantId: number,
  deltaQty: number,
  options?: { reason?: string; unitCost?: number; actorId?: number; batchId?: number | null }
) {
  if (options?.actorId != null) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { orgId: true },
    });
    if (!branch) throw new Error("Branch not found");
    const txnType =
      deltaQty > 0 ? "RECEIVE" : options.reason === "Package consumption" ? "PACKAGE_CONSUMPTION" : "ADJUSTMENT";
    await recordClinicalLedgerEntryStandalone({
      orgId: branch.orgId,
      branchId,
      clinicalItemId: itemId,
      variantId,
      batchId: options.batchId ?? undefined,
      txnType,
      quantityDelta: deltaQty,
      unitCost: options.unitCost ?? undefined,
      refType: options.reason ? "ADJUSTMENT" : undefined,
      refId: options.reason ?? undefined,
      note: options.reason ?? undefined,
      actorId: options.actorId,
    });
    return getOrCreateBranchStock(branchId, itemId, variantId);
  }

  const row = await getOrCreateBranchStock(branchId, itemId, variantId);
  const current = Number(row.currentQty);
  const newQty = Math.max(0, current + deltaQty);
  const reserved = Number(row.reservedQty);
  const available = Math.max(0, newQty - reserved);

  const { Decimal } = require("@prisma/client/runtime/library");
  await prisma.branchItemStock.update({
    where: { id: row.id },
    data: {
      currentQty: new Decimal(newQty),
      availableQty: new Decimal(available),
      ...(options?.unitCost != null && {
        lastPurchaseCost: options.unitCost,
        avgCost: options.unitCost,
      }),
    },
  });
  return getOrCreateBranchStock(branchId, itemId, variantId);
}

/** Get low-stock alerts for branch */
export async function getLowStockAlerts(branchId: number) {
  const rows = await prisma.branchItemStock.findMany({
    where: { branchId, reorderLevel: { not: null } },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
      variant: { select: { id: true, variantName: true, sku: true } },
    },
  });
  return rows.filter((r) => {
    const reorder = r.reorderLevel != null ? Number(r.reorderLevel) : null;
    const avail = Number(r.availableQty);
    return reorder != null && avail <= reorder;
  });
}

/** Create batch (for batch/expiry tracked items). When actorId is provided, receive is written through ClinicalStockLedger. */
export async function createBranchItemBatch(
  branchId: number,
  itemId: number,
  variantId: number,
  data: {
    batchNo: string;
    expiryDate?: Date | null;
    receivedQty: number;
    purchaseCost?: number | null;
    actorId?: number;
  }
) {
  const batch = await prisma.branchItemBatch.create({
    data: {
      branchId,
      itemId,
      variantId,
      batchNo: data.batchNo.trim(),
      expiryDate: data.expiryDate ?? undefined,
      receivedQty: data.receivedQty,
      remainingQty: data.receivedQty,
      usedQty: 0,
      purchaseCost: data.purchaseCost ?? undefined,
    },
  });
  await adjustBranchItemStock(branchId, itemId, variantId, data.receivedQty, {
    reason: "Receive",
    unitCost: data.purchaseCost ?? undefined,
    actorId: data.actorId,
  });
  return batch;
}

/** Get batches for branch/item/variant */
export async function getBranchItemBatches(options: {
  branchId: number;
  itemId?: number;
  variantId?: number;
  status?: string;
}) {
  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.itemId != null) where.itemId = options.itemId;
  if (options.variantId != null) where.variantId = options.variantId;
  if (options.status != null) where.status = options.status;

  return prisma.branchItemBatch.findMany({
    where,
    include: {
      item: { select: { name: true, itemCode: true } },
      variant: { select: { variantName: true } },
    },
    orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
  });
}
