/**
 * Inventory Consumption Engine: planned consumption from package template,
 * actual consumption recording, variance reconciliation, vial return tracking.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");

/** Create planned consumption from surgery package template (INCLUDED items only) */
export async function createPlannedConsumption(options: {
  clinicalCaseId?: number | null;
  procedureOrderId?: number | null;
  visitId?: number | null;
  surgeryPackageId: number;
}) {
  const pkg = await prisma.surgeryPackage.findUnique({
    where: { id: options.surgeryPackageId },
    include: {
      items: {
        where: { itemType: "INCLUDED" },
        include: {
          variant: { select: { id: true } },
          product: { select: { id: true } },
          clinicalItem: { select: { id: true } },
          clinicalItemVariant: { select: { id: true } },
        },
      },
    },
  });
  if (!pkg) throw new Error("Surgery package not found");

  const itemCreates: Array<{
    variantId?: number | null;
    productId?: number | null;
    clinicalItemId?: number | null;
    clinicalItemVariantId?: number | null;
    consumptionSource?: string | null;
    quantityPlanned?: any;
    unitCost?: any;
  }> = [];

  for (const i of pkg.items) {
    if (i.variantId != null) {
      itemCreates.push({
        variantId: i.variantId,
        productId: i.productId ?? undefined,
        quantityPlanned: i.estimatedQty ?? undefined,
        unitCost: i.estimatedCost ?? undefined,
      });
    } else if (i.clinicalItemId != null && i.clinicalItemVariantId != null) {
      itemCreates.push({
        clinicalItemId: i.clinicalItemId,
        clinicalItemVariantId: i.clinicalItemVariantId,
        consumptionSource: "CLINICAL_INVENTORY",
        quantityPlanned: i.estimatedQty ?? undefined,
        unitCost: i.estimatedCost ?? undefined,
      });
    }
  }

  const consumption = await prisma.inventoryConsumption.create({
    data: {
      clinicalCaseId: options.clinicalCaseId ?? undefined,
      procedureOrderId: options.procedureOrderId ?? undefined,
      visitId: options.visitId ?? undefined,
      mode: "PLANNED",
      status: "RECORDED",
      items: { create: itemCreates },
    },
    include: { items: true },
  });
  return consumption;
}

/**
 * When a procedure order is started (IN_PROGRESS): create planned consumption from package
 * and deduct clinical package items from branch stock via ClinicalStockLedger.
 * Call this after updating the procedure order status to IN_PROGRESS.
 */
export async function applyPackageClinicalDeduction(options: {
  procedureOrderId: number;
  clinicalCaseId: number;
  surgeryPackageId: number;
  branchId: number;
  orgId: number;
  actorId: number;
}) {
  const { procedureOrderId, clinicalCaseId, surgeryPackageId, branchId, orgId, actorId } = options;
  const pkg = await prisma.surgeryPackage.findUnique({
    where: { id: surgeryPackageId },
    include: {
      items: {
        where: { itemType: "INCLUDED", clinicalItemId: { not: null }, clinicalItemVariantId: { not: null } },
        include: { clinicalItem: { select: { id: true } }, clinicalItemVariant: { select: { id: true } } },
      },
    },
  });
  if (!pkg || !pkg.items.length) return null;

  await createPlannedConsumption({
    procedureOrderId,
    clinicalCaseId,
    surgeryPackageId,
  });

  const clinicalItems = pkg.items.filter(
    (i) => i.clinicalItemId != null && i.clinicalItemVariantId != null
  );
  if (clinicalItems.length === 0) return null;

  await prisma.$transaction(async (tx: any) => {
    for (const item of clinicalItems) {
      const qty = Math.abs(Number(item.estimatedQty ?? 0));
      if (qty <= 0) continue;
      await clinicalStockLedgerService.recordClinicalLedgerEntry(tx, {
        orgId,
        branchId,
        clinicalItemId: item.clinicalItemId!,
        variantId: item.clinicalItemVariantId!,
        txnType: "PACKAGE_CONSUMPTION",
        quantityDelta: -qty,
        refType: "PACKAGE",
        refId: String(procedureOrderId),
        note: `Procedure order ${procedureOrderId} start`,
        actorId,
      });
    }
  });
  return { plannedConsumptionCreated: true, itemsDeducted: clinicalItems.length };
}

/** Record actual consumption (add or update consumption record with actual qty). Supports both retail (variantId) and clinical (clinicalItemId/clinicalItemVariantId) items. */
export async function recordActualConsumption(options: {
  clinicalCaseId?: number | null;
  procedureOrderId?: number | null;
  visitId?: number | null;
  items: {
    variantId?: number | null;
    productId?: number | null;
    lotId?: number | null;
    clinicalItemId?: number | null;
    clinicalItemVariantId?: number | null;
    batchId?: number | null;
    quantityActual: number;
    unitCost?: number | null;
    wastageFlag?: boolean;
    consumptionSource?: string | null;
  }[];
}) {
  const consumption = await prisma.inventoryConsumption.create({
    data: {
      clinicalCaseId: options.clinicalCaseId ?? undefined,
      procedureOrderId: options.procedureOrderId ?? undefined,
      visitId: options.visitId ?? undefined,
      mode: "ACTUAL",
      status: "RECORDED",
      items: {
        create: options.items.map((i) => ({
          variantId: i.variantId ?? undefined,
          productId: i.productId ?? undefined,
          lotId: i.lotId ?? undefined,
          clinicalItemId: i.clinicalItemId ?? undefined,
          clinicalItemVariantId: i.clinicalItemVariantId ?? undefined,
          batchId: i.batchId ?? undefined,
          consumptionSource: i.consumptionSource ?? undefined,
          quantityActual: i.quantityActual,
          unitCost: i.unitCost ?? undefined,
          wastageFlag: i.wastageFlag ?? false,
        })),
      },
    },
    include: { items: true },
  });
  emit(DOMAIN_EVENTS.INVENTORY_CONSUMED, {
    consumptionId: consumption.id,
    clinicalCaseId: options.clinicalCaseId ?? null,
    procedureOrderId: options.procedureOrderId ?? null,
    visitId: options.visitId ?? null,
    itemCount: options.items.length,
  });
  return consumption;
}

/** Get recent consumptions for a branch (via clinical cases at this branch) */
export async function getConsumptionForBranch(options: {
  branchId: number;
  limit?: number;
  offset?: number;
}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const consumptions = await prisma.inventoryConsumption.findMany({
    where: {
      clinicalCase: { branchId: options.branchId },
    },
    include: {
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          product: { select: { id: true, name: true } },
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
        },
      },
      clinicalCase: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  const total = await prisma.inventoryConsumption.count({
    where: { clinicalCase: { branchId: options.branchId } },
  });
  return { items: consumptions, total };
}

/** Get consumption for a case (planned + actual) with variance summary */
export async function getConsumptionForCase(clinicalCaseId: number) {
  const consumptions = await prisma.inventoryConsumption.findMany({
    where: { clinicalCaseId },
    include: {
      items: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          product: { select: { id: true, name: true } },
          lot: { select: { id: true, lotCode: true } },
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          clinicalItemVariant: { select: { id: true, variantName: true, sku: true } },
          batch: { select: { id: true, batchNo: true, expiryDate: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return consumptions;
}

/** Reconcile planned vs actual: compute variance and write InventoryVarianceLog entries */
export async function reconcileVariance(consumptionId: number) {
  const consumption = await prisma.inventoryConsumption.findUnique({
    where: { id: consumptionId },
    include: {
      items: {
        include: { variant: { select: { id: true } } },
      },
    },
  });
  if (!consumption) throw new Error("Inventory consumption not found");

  const plannedByVariant = new Map<
    number,
    { quantityPlanned: number; unitCost: number | null }
  >();
  const actualByVariant = new Map<
    number,
    { quantityActual: number; unitCost: number | null }
  >();

  for (const item of consumption.items) {
    const vId = item.variantId;
    if (vId == null) continue;
    if (item.quantityPlanned != null) {
      const prev = plannedByVariant.get(vId) ?? {
        quantityPlanned: 0,
        unitCost: item.unitCost != null ? Number(item.unitCost) : null,
      };
      prev.quantityPlanned += Number(item.quantityPlanned);
      plannedByVariant.set(vId, prev);
    }
    if (item.quantityActual != null) {
      const prev = actualByVariant.get(vId) ?? {
        quantityActual: 0,
        unitCost: item.unitCost != null ? Number(item.unitCost) : null,
      };
      prev.quantityActual += Number(item.quantityActual);
      actualByVariant.set(vId, prev);
    }
  }

  const allVariantIds = new Set([
    ...plannedByVariant.keys(),
    ...actualByVariant.keys(),
  ]);
  const logs = [];

  for (const variantId of allVariantIds) {
    const planned = plannedByVariant.get(variantId)?.quantityPlanned ?? 0;
    const actual = actualByVariant.get(variantId)?.quantityActual ?? 0;
    const variance = actual - planned;
    if (variance === 0) continue;

    const unitCost =
      actualByVariant.get(variantId)?.unitCost ??
      plannedByVariant.get(variantId)?.unitCost ?? null;
    const varianceCost = unitCost != null ? variance * unitCost : null;

    const log = await prisma.inventoryVarianceLog.create({
      data: {
        inventoryConsumptionId: consumptionId,
        variantId,
        quantityPlanned: planned,
        quantityActual: actual,
        variance,
        varianceCost: varianceCost ?? undefined,
      },
    });
    logs.push(log);
  }

  return logs;
}

/** Get variance summary for a case */
export async function getVarianceForCase(clinicalCaseId: number) {
  const consumptions = await prisma.inventoryConsumption.findMany({
    where: { clinicalCaseId },
    select: { id: true },
  });
  const consumptionIds = consumptions.map((c) => c.id);
  const logs = await prisma.inventoryVarianceLog.findMany({
    where: { inventoryConsumptionId: { in: consumptionIds } },
    include: {
      variant: { select: { id: true, sku: true, title: true } },
    },
  });
  return logs;
}

// --- Vial return control ---

/** Create vial return control when issuing to procedure */
export async function createVialReturnControl(data: {
  branchId: number;
  clinicalCaseId?: number | null;
  procedureOrderId?: number | null;
  visitId?: number | null;
  variantId: number;
  issuedQty: number;
  auditHoldDays?: number;
}) {
  const holdDays = data.auditHoldDays ?? 7;
  const returnDueAt = new Date();
  returnDueAt.setDate(returnDueAt.getDate() + holdDays);

  const control = await prisma.vialReturnControl.create({
    data: {
      branchId: data.branchId,
      clinicalCaseId: data.clinicalCaseId ?? undefined,
      procedureOrderId: data.procedureOrderId ?? undefined,
      visitId: data.visitId ?? undefined,
      variantId: data.variantId,
      issuedQty: data.issuedQty,
      returnDueAt,
      auditHoldDays: holdDays,
    },
  });
  return control;
}

/** Mark vial as returned */
export async function markVialReturned(controlId: number, branchId: number) {
  const control = await prisma.vialReturnControl.findFirst({
    where: { id: controlId, branchId },
  });
  if (!control) throw new Error("Vial return control not found");

  return prisma.vialReturnControl.update({
    where: { id: controlId },
    data: { returnedAt: new Date() },
  });
}

/** List pending vial returns (not yet returned, optionally overdue) */
export async function listPendingVialReturns(
  branchId: number,
  options?: { overdueOnly?: boolean }
) {
  const where: Record<string, unknown> = { branchId, returnedAt: null };
  if (options?.overdueOnly) {
    where.returnDueAt = { lt: new Date() };
  }

  return prisma.vialReturnControl.findMany({
    where,
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      clinicalCase: { select: { id: true } },
    },
    orderBy: { returnDueAt: "asc" },
  });
}

/** Set missing alert and optionally block next issue */
export async function markVialMissing(
  controlId: number,
  branchId: number,
  options?: { blockNextIssue?: boolean }
) {
  const control = await prisma.vialReturnControl.findFirst({
    where: { id: controlId, branchId },
  });
  if (!control) throw new Error("Vial return control not found");

  return prisma.vialReturnControl.update({
    where: { id: controlId },
    data: {
      missingAlertAt: new Date(),
      nextIssueBlocked: options?.blockNextIssue ?? false,
    },
  });
}
