/**
 * Clinical Stock Transfer: move clinical items from one branch (e.g. central warehouse) to another.
 * Can be created from an approved ClinicalSupplyRequest or standalone.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");
const { createBranchItemBatchInTx } = require("./clinicalItemStock.service");
const {
  isVaccineClinicalItem,
  isExpiredLotDate,
} = require("./vaccineInventoryBridge.service");

async function generateTransferNo(orgId: number): Promise<string> {
  const count = await prisma.clinicalStockTransfer.count({
    where: { orgId },
  });
  const pad = String(count + 1).padStart(5, "0");
  return `CST-${orgId}-${pad}-${Date.now().toString(36).toUpperCase()}`;
}

/** Create a transfer from an approved supply request (owner). Fulfills request items from fromBranchId (e.g. central warehouse). */
export async function createTransferFromRequest(
  supplyRequestId: number,
  orgId: number,
  fromBranchId: number,
  options?: { actorId?: number }
) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: supplyRequestId, orgId },
    include: {
      items: { where: { approvedQty: { not: null } }, include: { clinicalItem: true, variant: true } },
      branch: true,
    },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "APPROVED" && request.status !== "PARTIAL_APPROVED" && request.status !== "PARTIALLY_APPROVED")
    throw new Error("Only approved supply requests can be dispatched");
  const toBranchId = request.branchId;

  const transferNo = await generateTransferNo(orgId);
  const transfer = await prisma.clinicalStockTransfer.create({
    data: {
      orgId,
      transferNo,
      supplyRequestId,
      fromBranchId,
      toBranchId,
      status: "CREATED",
      items: {
        create: request.items
          .filter((i) => i.approvedQty != null && Number(i.approvedQty) > 0)
          .map((i) => ({
            clinicalItemId: i.clinicalItemId,
            variantId: i.variantId ?? undefined,
            qtySent: Number(i.approvedQty),
          })),
      },
    },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
      fromBranch: { select: { id: true, name: true } },
      toBranch: { select: { id: true, name: true } },
    },
  });
  return transfer;
}

/** Mark transfer as dispatched (owner). Deducts stock from fromBranch via ClinicalStockLedger. */
export async function dispatchTransfer(transferId: number, orgId: number, dispatchedById: number) {
  const transfer = await prisma.clinicalStockTransfer.findFirst({
    where: { id: transferId, orgId },
    include: { items: true },
  });
  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status !== "CREATED") throw new Error("Only CREATED transfers can be dispatched");

  await prisma.$transaction(async (tx: any) => {
    for (const line of transfer.items) {
      const variantId = line.variantId ?? (await tx.clinicalItemVariant.findFirst({
        where: { itemId: line.clinicalItemId },
        select: { id: true },
      }))?.id;
      if (!variantId) continue;
      await clinicalStockLedgerService.recordClinicalLedgerEntry(tx, {
        orgId: transfer.orgId,
        branchId: transfer.fromBranchId,
        clinicalItemId: line.clinicalItemId,
        variantId,
        txnType: "TRANSFER_OUT",
        quantityDelta: -line.qtySent,
        refType: "TRANSFER",
        refId: String(transfer.id),
        note: `Transfer to branch ${transfer.toBranchId}`,
        actorId: dispatchedById,
      });
    }
  });

  return prisma.clinicalStockTransfer.update({
    where: { id: transferId },
    data: { status: "IN_TRANSIT", dispatchedById, dispatchedAt: new Date() },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}

/** Record receipt at toBranch (branch staff). Credits stock via ClinicalStockLedger and updates request fulfilled qty. */
export async function receiveTransfer(
  transferId: number,
  toBranchId: number,
  receivedById: number,
  receivedItems: Array<{ transferItemId: number; qtyReceived: number; qtyDamaged?: number }>
) {
  const transfer = await prisma.clinicalStockTransfer.findFirst({
    where: { id: transferId, toBranchId },
    include: { items: true, supplyRequestId: true },
  });
  if (!transfer) throw new Error("Transfer not found");
  if (transfer.status !== "IN_TRANSIT") throw new Error("Only IN_TRANSIT transfers can be received");

  const byItemId = new Map(receivedItems.map((r) => [r.transferItemId, r]));

  await prisma.$transaction(async (tx: any) => {
    for (const line of transfer.items) {
      const rec = byItemId.get(line.id);
      const qtyReceived = rec?.qtyReceived ?? line.qtySent;
      const qtyDamaged = rec?.qtyDamaged ?? 0;
      const netReceived = Math.max(0, qtyReceived - qtyDamaged);
      if (netReceived <= 0) continue;

      const variantId = line.variantId ?? (await tx.clinicalItemVariant.findFirst({
        where: { itemId: line.clinicalItemId },
        select: { id: true },
      }))?.id;
      if (!variantId) continue;

      const clinicalItem = await tx.clinicalItem.findUnique({
        where: { id: line.clinicalItemId },
        include: { category: true },
      });
      const useBatchReceive =
        clinicalItem &&
        (clinicalItem.requiresBatch === true ||
          clinicalItem.requiresExpiry === true ||
          isVaccineClinicalItem(clinicalItem));

      const existingMirror = await tx.branchItemBatch.findFirst({
        where: { sourceClinicalTransferItemId: line.id },
      });
      if (existingMirror) {
        await tx.clinicalStockTransferItem.update({
          where: { id: line.id },
          data: { qtyReceived: netReceived, qtyDamaged: qtyDamaged || undefined },
        });
        continue;
      }

      if (useBatchReceive) {
        const allowExpired = String(process.env.ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC || "").toLowerCase() === "true";
        if (line.expiryDate && !allowExpired && isExpiredLotDate(line.expiryDate)) {
          throw new Error(
            "Expired vaccine batch cannot be received unless ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC is enabled"
          );
        }
        const batchNo =
          line.batchNo != null && String(line.batchNo).trim().length > 0
            ? String(line.batchNo).trim()
            : `CST-${transfer.id}-${line.id}`;
        await createBranchItemBatchInTx(tx, transfer.toBranchId, line.clinicalItemId, variantId, {
          batchNo,
          expiryDate: line.expiryDate ?? undefined,
          receivedQty: netReceived,
          purchaseCost: null,
          actorId: receivedById,
          sourceClinicalTransferItemId: line.id,
        });
      } else {
        await clinicalStockLedgerService.recordClinicalLedgerEntry(tx, {
          orgId: transfer.orgId,
          branchId: transfer.toBranchId,
          clinicalItemId: line.clinicalItemId,
          variantId,
          txnType: "TRANSFER_IN",
          quantityDelta: netReceived,
          refType: "TRANSFER",
          refId: String(transfer.id),
          note: `Received from transfer ${transfer.transferNo}`,
          actorId: receivedById,
        });
      }

      await tx.clinicalStockTransferItem.update({
        where: { id: line.id },
        data: { qtyReceived: netReceived, qtyDamaged: qtyDamaged || undefined },
      });
    }

    if (transfer.supplyRequestId) {
      const request = await tx.clinicalSupplyRequest.findUnique({
        where: { id: transfer.supplyRequestId },
        include: { items: true },
      });
      if (request) {
        for (const line of transfer.items) {
          const reqItem = request.items.find(
            (i: any) => i.clinicalItemId === line.clinicalItemId && (i.variantId === line.variantId || (!i.variantId && !line.variantId))
          );
          if (reqItem) {
            const rec = byItemId.get(line.id);
            const qty = rec?.qtyReceived ?? line.qtySent;
            await tx.clinicalSupplyRequestItem.update({
              where: { id: reqItem.id },
              data: { fulfilledQty: { increment: Math.max(0, qty - (rec?.qtyDamaged ?? 0)) } },
            });
          }
        }
      }
    }
  });

  return prisma.clinicalStockTransfer.update({
    where: { id: transferId },
    data: { status: "RECEIVED", receivedById, receivedAt: new Date() },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}

/** Get transfer history for org or branch */
export async function getTransferHistory(options: {
  orgId: number;
  branchId?: number;
  direction?: "from" | "to";
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = { orgId: options.orgId };
  if (options.branchId != null) {
    if (options.direction === "from") where.fromBranchId = options.branchId;
    else if (options.direction === "to") where.toBranchId = options.branchId;
    else {
      where.OR = [{ fromBranchId: options.branchId }, { toBranchId: options.branchId }];
    }
  }
  if (options.status != null) where.status = options.status;

  const [items, total] = await Promise.all([
    prisma.clinicalStockTransfer.findMany({
      where,
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        items: {
          include: {
            clinicalItem: { select: { id: true, name: true } },
            variant: { select: { id: true, variantName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    }),
    prisma.clinicalStockTransfer.count({ where }),
  ]);
  return { items, total };
}

/** Get one transfer by id */
export async function getTransferById(transferId: number, scope?: { orgId?: number; toBranchId?: number }) {
  const where: Record<string, unknown> = { id: transferId };
  if (scope?.orgId != null) where.orgId = scope.orgId;
  if (scope?.toBranchId != null) where.toBranchId = scope.toBranchId;

  return prisma.clinicalStockTransfer.findFirst({
    where,
    include: {
      fromBranch: { select: { id: true, name: true } },
      toBranch: { select: { id: true, name: true } },
      supplyRequest: { select: { id: true, requestNo: true } },
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}
