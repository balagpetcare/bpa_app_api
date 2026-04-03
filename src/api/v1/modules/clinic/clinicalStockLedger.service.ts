/**
 * Clinical Stock Ledger: immutable ledger for clinical item stock movements.
 * All clinical stock changes should go through recordClinicalLedgerEntry to maintain
 * BranchItemStock (and optionally BranchItemBatch) in sync with a full audit trail.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { Decimal } = require("@prisma/client-runtime-utils");

export type ClinicalLedgerEntryInput = {
  orgId: number;
  branchId: number;
  clinicalItemId: number;
  variantId: number;
  batchId?: number | null;
  txnType: string;
  quantityDelta: number;
  unitCost?: number | null;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  actorId: number;
};

/**
 * Record a clinical stock ledger entry and update BranchItemStock (and optionally BranchItemBatch).
 * Must be called within an existing transaction (tx) for atomicity.
 * quantityDelta: positive = stock in, negative = stock out.
 */
export async function recordClinicalLedgerEntry(
  tx: any,
  data: ClinicalLedgerEntryInput
): Promise<{ ledgerId: number; balanceAfter: number }> {
  const stockWhere = {
    branchId_itemId_variantId: {
      branchId: data.branchId,
      itemId: data.clinicalItemId,
      variantId: data.variantId,
    },
  };

  let stockRow = await tx.branchItemStock.findUnique({ where: stockWhere });
  if (!stockRow) {
    stockRow = await tx.branchItemStock.create({
      data: {
        branchId: data.branchId,
        itemId: data.clinicalItemId,
        variantId: data.variantId,
        currentQty: 0,
        reservedQty: 0,
        availableQty: 0,
      },
    });
  }

  const currentQty = Number(stockRow.currentQty);
  const reservedQty = Number(stockRow.reservedQty);
  const newQty = currentQty + data.quantityDelta;
  if (newQty < 0) {
    throw new Error(
      `Insufficient clinical stock. itemId=${data.clinicalItemId} variantId=${data.variantId} current=${currentQty} delta=${data.quantityDelta}`
    );
  }
  const balanceAfter = newQty;
  const availableQty = Math.max(0, newQty - reservedQty);

  const ledger = await tx.clinicalStockLedger.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      clinicalItemId: data.clinicalItemId,
      variantId: data.variantId,
      batchId: data.batchId ?? undefined,
      txnType: data.txnType,
      quantityDelta: data.quantityDelta,
      balanceAfter,
      unitCost: data.unitCost ?? undefined,
      refType: data.refType ?? undefined,
      refId: data.refId ?? undefined,
      note: data.note ?? undefined,
      actorId: data.actorId,
    },
  });

  await tx.branchItemStock.update({
    where: { id: stockRow.id },
    data: {
      currentQty: new Decimal(newQty),
      availableQty: new Decimal(availableQty),
      ...(data.unitCost != null && {
        lastPurchaseCost: data.unitCost,
        avgCost: data.unitCost,
      }),
    },
  });

  if (data.batchId != null && data.quantityDelta < 0) {
    const batch = await tx.branchItemBatch.findUnique({
      where: { id: data.batchId },
      select: { usedQty: true, remainingQty: true },
    });
    if (batch) {
      const usedDelta = Math.min(Number(batch.remainingQty), -data.quantityDelta);
      await tx.branchItemBatch.update({
        where: { id: data.batchId },
        data: {
          usedQty: { increment: usedDelta },
          remainingQty: { decrement: usedDelta },
        },
      });
    }
  }

  return { ledgerId: ledger.id, balanceAfter };
}

/**
 * Record ledger entry using a new transaction (convenience wrapper).
 */
export async function recordClinicalLedgerEntryStandalone(
  data: ClinicalLedgerEntryInput
): Promise<{ ledgerId: number; balanceAfter: number }> {
  return prisma.$transaction(async (tx: any) =>
    recordClinicalLedgerEntry(tx, data)
  );
}

/**
 * Get clinical stock ledger history for a branch, optionally filtered by item/variant.
 */
export async function getClinicalStockHistory(options: {
  branchId: number;
  clinicalItemId?: number;
  variantId?: number;
  limit?: number;
  offset?: number;
  fromDate?: Date;
  toDate?: Date;
}) {
  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.clinicalItemId != null) where.clinicalItemId = options.clinicalItemId;
  if (options.variantId != null) where.variantId = options.variantId;
  if (options.fromDate != null || options.toDate != null) {
    where.createdAt = {};
    if (options.fromDate != null) (where.createdAt as any).gte = options.fromDate;
    if (options.toDate != null) (where.createdAt as any).lte = options.toDate;
  }

  const [rows, total] = await Promise.all([
    prisma.clinicalStockLedger.findMany({
      where,
      include: {
        clinicalItem: { select: { id: true, name: true, itemCode: true } },
        variant: { select: { id: true, variantName: true, sku: true } },
        batch: { select: { id: true, batchNo: true, expiryDate: true } },
        actor: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    }),
    prisma.clinicalStockLedger.count({ where }),
  ]);

  return { items: rows, total };
}
