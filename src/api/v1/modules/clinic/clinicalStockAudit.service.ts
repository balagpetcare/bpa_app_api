/**
 * Clinical stock audit: physical count vs system stock, variance resolution, adjustments via ledger.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");

const AUDIT_SCOPES = ["FULL", "PARTIAL", "RANDOM"] as const;
const AUDIT_STATUSES = ["DRAFT", "IN_PROGRESS", "FROZEN", "COMPLETED", "APPROVED"] as const;

async function generateAuditNo(branchId: number): Promise<string> {
  const count = await prisma.clinicalStockAudit.count({ where: { branchId } });
  const pad = String(count + 1).padStart(5, "0");
  return `CSA-${branchId}-${pad}-${Date.now().toString(36).toUpperCase()}`;
}

/** Create a new audit (DRAFT). */
export async function createAudit(branchId: number, scope: string, initiatedById: number) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  const s = scope?.toUpperCase();
  if (!AUDIT_SCOPES.includes(s as any)) throw new Error("Invalid auditScope");

  const auditNo = await generateAuditNo(branchId);
  return prisma.clinicalStockAudit.create({
    data: {
      orgId: branch.orgId,
      branchId,
      auditNo,
      auditScope: s,
      status: "DRAFT",
      initiatedById,
    },
    include: {
      initiatedBy: { select: { id: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

/** Start audit (DRAFT -> IN_PROGRESS). */
export async function startAudit(auditId: number, scope: { branchId?: number }) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const audit = await prisma.clinicalStockAudit.findFirst({ where });
  if (!audit) throw new Error("Audit not found");
  if (audit.status !== "DRAFT") throw new Error("Only DRAFT audits can be started");

  return prisma.clinicalStockAudit.update({
    where: { id: auditId },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
    include: { lines: { include: { clinicalItem: { select: { id: true, name: true } }, variant: { select: { id: true, variantName: true } } } } },
  });
}

/** Freeze audit (stop movement for count). */
export async function freezeAudit(auditId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const audit = await prisma.clinicalStockAudit.findFirst({ where });
  if (!audit) throw new Error("Audit not found");
  if (audit.status !== "IN_PROGRESS") throw new Error("Only IN_PROGRESS audits can be frozen");

  return prisma.clinicalStockAudit.update({
    where: { id: auditId },
    data: { status: "FROZEN" },
    include: { lines: true },
  });
}

/** Record physical counts (creates or updates lines). varianceQty = physicalQty - systemQty. */
export async function recordAuditCount(
  auditId: number,
  lines: Array<{
    clinicalItemId: number;
    variantId?: number | null;
    batchNo?: string | null;
    systemQty: number;
    physicalQty: number;
    varianceReason?: string | null;
  }>,
  scope?: { branchId?: number }
) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const audit = await prisma.clinicalStockAudit.findFirst({ where });
  if (!audit) throw new Error("Audit not found");
  if (audit.status !== "IN_PROGRESS" && audit.status !== "FROZEN") throw new Error("Audit is not in progress or frozen");

  const existingLines = await prisma.clinicalStockAuditLine.findMany({
    where: { auditId },
  });
  const lineMap = new Map(existingLines.map((l) => [`${l.clinicalItemId}-${l.variantId ?? 0}-${l.batchNo ?? ""}`, l]));

  for (const line of lines) {
    const varianceQty = line.physicalQty - line.systemQty;
    const key = `${line.clinicalItemId}-${line.variantId ?? 0}-${line.batchNo ?? ""}`;
    const existing = lineMap.get(key);
    if (existing) {
      const ex = existing as { id: number };
      await prisma.clinicalStockAuditLine.update({
        where: { id: ex.id },
        data: {
          systemQty: line.systemQty,
          physicalQty: line.physicalQty,
          varianceQty,
          varianceReason: line.varianceReason ?? undefined,
        },
      });
    } else {
      await prisma.clinicalStockAuditLine.create({
        data: {
          auditId,
          clinicalItemId: line.clinicalItemId,
          variantId: line.variantId ?? undefined,
          batchNo: line.batchNo ?? undefined,
          systemQty: line.systemQty,
          physicalQty: line.physicalQty,
          varianceQty,
          varianceReason: line.varianceReason ?? undefined,
        },
      });
    }
  }
  return getAuditById(auditId, scope);
}

/** Calculate variance for all lines (recompute varianceQty). */
export async function calculateVariance(auditId: number, scope?: { branchId?: number }) {
  const lines = await prisma.clinicalStockAuditLine.findMany({
    where: { auditId },
  });
  for (const line of lines) {
    const varianceQty = (line.physicalQty ?? line.systemQty) - line.systemQty;
    await prisma.clinicalStockAuditLine.update({
      where: { id: line.id },
      data: { varianceQty },
    });
  }
  return getAuditById(auditId, scope);
}

/** Get audit by id. */
export async function getAuditById(auditId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  return prisma.clinicalStockAudit.findFirst({
    where,
    include: {
      lines: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
      initiatedBy: { select: { id: true } },
      approvedBy: { select: { id: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}

/** List audits for branch. */
export async function listAudits(branchId: number, options?: { status?: string; limit?: number; offset?: number }) {
  const where: Record<string, unknown> = { branchId };
  if (options?.status) where.status = options.status;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const [items, total] = await Promise.all([
    prisma.clinicalStockAudit.findMany({
      where,
      include: { initiatedBy: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.clinicalStockAudit.count({ where }),
  ]);
  return { items, total };
}

/** Approve audit: post adjustments via ClinicalStockLedger (ADJUSTMENT), then mark APPROVED. */
export async function approveAudit(auditId: number, approvedById: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const audit = await prisma.clinicalStockAudit.findFirst({
    where,
    include: { lines: true },
  });
  if (!audit) throw new Error("Audit not found");
  if (audit.status !== "FROZEN" && audit.status !== "COMPLETED") throw new Error("Only FROZEN or COMPLETED audits can be approved");

  await prisma.$transaction(async (tx: any) => {
    for (const line of audit.lines) {
      const varianceQty = (line.varianceQty ?? 0) || (line.physicalQty ?? line.systemQty) - line.systemQty;
      if (varianceQty === 0) continue;
      const variantId = line.variantId ?? await tx.clinicalItemVariant.findFirst({ where: { itemId: line.clinicalItemId }, select: { id: true } }).then((v: any) => v?.id);
      if (variantId == null) continue;
      await clinicalStockLedgerService.recordClinicalLedgerEntry(tx, {
        orgId: audit.orgId,
        branchId: audit.branchId,
        clinicalItemId: line.clinicalItemId,
        variantId,
        txnType: "ADJUSTMENT",
        quantityDelta: varianceQty,
        refType: "AUDIT",
        refId: String(auditId),
        note: line.varianceReason ?? "Audit adjustment",
        actorId: approvedById,
      });
    }
    await tx.clinicalStockAudit.update({
      where: { id: auditId },
      data: { status: "APPROVED", approvedById, completedAt: new Date() },
    });
  });

  return getAuditById(auditId, scope);
}

/** Mark audit COMPLETED (counts recorded, ready for approval). */
export async function completeAudit(auditId: number, scope?: { branchId?: number }) {
  const where: Record<string, unknown> = { id: auditId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  const audit = await prisma.clinicalStockAudit.findFirst({ where });
  if (!audit) throw new Error("Audit not found");
  if (audit.status !== "IN_PROGRESS" && audit.status !== "FROZEN") throw new Error("Audit cannot be completed");

  return prisma.clinicalStockAudit.update({
    where: { id: auditId },
    data: { status: "COMPLETED", completedAt: new Date() },
    include: { lines: { include: { clinicalItem: true, variant: true } } },
  });
}
