/**
 * Clinical wastage: log expired/damaged/contaminated stock, owner approval, deduct via ledger.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");

const WASTAGE_TYPES = ["EXPIRED", "DAMAGED", "STERILE_BREACH", "CONTAMINATED", "OVERUSE", "UNEXPLAINED"] as const;
const WASTAGE_STATUSES = ["PENDING", "APPROVED", "INVESTIGATED"] as const;

/** Report wastage (staff). */
export async function reportWastage(
  branchId: number,
  reportedById: number,
  data: {
    clinicalItemId: number;
    variantId?: number | null;
    batchNo?: string | null;
    wastageType: string;
    qty: number;
    reason?: string | null;
  }
) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  const wt = data.wastageType?.toUpperCase();
  if (!WASTAGE_TYPES.includes(wt as any)) throw new Error("Invalid wastageType");
  if (data.qty <= 0) throw new Error("qty must be positive");

  return prisma.clinicalWastageLog.create({
    data: {
      orgId: branch.orgId,
      branchId,
      clinicalItemId: data.clinicalItemId,
      variantId: data.variantId ?? undefined,
      batchNo: data.batchNo ?? undefined,
      wastageType: wt,
      qty: data.qty,
      reason: data.reason ?? undefined,
      reportedById,
      status: "PENDING",
    },
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
      variant: { select: { id: true, variantName: true } },
      reportedBy: { select: { id: true } },
    },
  });
}

/** Approve wastage (owner): deduct stock via ClinicalStockLedger (WASTAGE), set status APPROVED. */
export async function approveWastage(wastageId: number, approvedById: number, scope?: { orgId?: number }) {
  const where: Record<string, unknown> = { id: wastageId };
  if (scope?.orgId != null) where.orgId = scope.orgId;
  const log = await prisma.clinicalWastageLog.findFirst({
    where,
    include: { clinicalItem: true },
  });
  if (!log) throw new Error("Wastage log not found");
  if (log.status !== "PENDING") throw new Error("Only PENDING wastage can be approved");

  let variantId = log.variantId;
  if (variantId == null) {
    const v = await prisma.clinicalItemVariant.findFirst({
      where: { itemId: log.clinicalItemId },
      select: { id: true },
    });
    variantId = v?.id ?? null;
  }
  if (variantId == null) throw new Error("No variant for this clinical item");

  await clinicalStockLedgerService.recordClinicalLedgerEntryStandalone({
    orgId: log.orgId,
    branchId: log.branchId,
    clinicalItemId: log.clinicalItemId,
    variantId,
    txnType: "WASTAGE",
    quantityDelta: -log.qty,
    refType: "AUDIT",
    refId: String(wastageId),
    note: log.reason ?? `Wastage ${log.wastageType}`,
    actorId: approvedById,
  });

  return prisma.clinicalWastageLog.update({
    where: { id: wastageId },
    data: { status: "APPROVED", approvedById },
    include: {
      clinicalItem: { select: { id: true, name: true } },
      variant: { select: { id: true, variantName: true } },
      reportedBy: { select: { id: true } },
      approvedBy: { select: { id: true } },
    },
  });
}

/** List wastage logs for branch. */
export async function listWastageLogs(branchId: number, options?: { status?: string; limit?: number; offset?: number }) {
  const where: Record<string, unknown> = { branchId };
  if (options?.status) where.status = options.status;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const [items, total] = await Promise.all([
    prisma.clinicalWastageLog.findMany({
      where,
      include: {
        clinicalItem: { select: { id: true, name: true, itemCode: true } },
        variant: { select: { id: true, variantName: true } },
        reportedBy: { select: { id: true } },
        approvedBy: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.clinicalWastageLog.count({ where }),
  ]);
  return { items, total };
}

/** Get one wastage log by id. */
export async function getWastageLogById(wastageId: number, scope?: { branchId?: number; orgId?: number }) {
  const where: Record<string, unknown> = { id: wastageId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  if (scope?.orgId != null) where.orgId = scope.orgId;
  return prisma.clinicalWastageLog.findFirst({
    where,
    include: {
      clinicalItem: { select: { id: true, name: true, itemCode: true } },
      variant: { select: { id: true, variantName: true } },
      reportedBy: { select: { id: true } },
      approvedBy: { select: { id: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}
