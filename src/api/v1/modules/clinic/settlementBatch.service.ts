/**
 * Doctor Settlement Batch: generate batches (daily/weekly/monthly from branch config),
 * review, approve, pay; dispute handling.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");

export type SettlementCycle = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

function getPeriodBounds(
  cycle: SettlementCycle,
  periodEnd: Date
): { start: Date; end: Date } {
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);

  switch (cycle) {
    case "DAILY":
      start.setHours(0, 0, 0, 0);
      break;
    case "WEEKLY":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "BIWEEKLY":
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      break;
    case "MONTHLY":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    default:
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

/** Get branch settlement cycle from ClinicFinanceConfig or default MONTHLY */
async function getSettlementCycleForBranch(branchId: number): Promise<SettlementCycle> {
  const config = await prisma.clinicFinanceConfig.findUnique({
    where: { branchId },
    select: { settlementCycle: true },
  });
  return (config?.settlementCycle as SettlementCycle) ?? "MONTHLY";
}

/** Generate settlement batches for a branch for a given period (or use cycle end date) */
export async function generateBatchesForBranch(
  branchId: number,
  options?: { periodEnd?: Date; doctorProfileIds?: number[] }
) {
  const org = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!org) throw new Error("Branch not found");

  const cycle = await getSettlementCycleForBranch(branchId);
  const periodEnd = options?.periodEnd ?? new Date();
  const { start: periodStart, end: periodEndNorm } = getPeriodBounds(
    cycle,
    periodEnd
  );

  const ledgerWhere: Record<string, unknown> = {
    branchId,
    settlementStatus: "PENDING",
    batchId: null,
    createdAt: { gte: periodStart, lte: periodEndNorm },
  };
  if (options?.doctorProfileIds?.length) {
    ledgerWhere.clinicStaffProfileId = { in: options.doctorProfileIds };
  }

  const ledgerGroups = await prisma.doctorSettlementLedger.groupBy({
    by: ["clinicStaffProfileId"],
    where: ledgerWhere,
    _sum: { doctorShare: true },
    _count: true,
  });

  const batches = [];
  for (const g of ledgerGroups) {
    const totalAccrued = Number(g._sum.doctorShare ?? 0);
    if (totalAccrued <= 0) continue;

    const contract = await prisma.doctorContract.findFirst({
      where: {
        clinicStaffProfileId: g.clinicStaffProfileId,
        branchId,
        status: "ACTIVE",
        effectiveFrom: { lte: periodEndNorm },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
      select: { id: true },
    });

    const existing = await prisma.doctorSettlementBatch.findFirst({
      where: {
        branchId,
        clinicStaffProfileId: g.clinicStaffProfileId,
        periodStart,
        periodEnd: periodEndNorm,
      },
    });
    if (existing) continue;

    const batch = await prisma.doctorSettlementBatch.create({
      data: {
        orgId: org.orgId,
        branchId,
        clinicStaffProfileId: g.clinicStaffProfileId,
        contractId: contract?.id ?? undefined,
        periodStart,
        periodEnd: periodEndNorm,
        totalAccrued,
        totalAdjustments: 0,
        totalDeductions: 0,
        netPayable: totalAccrued,
        status: "DRAFT",
      },
    });
    batches.push(batch);

    await prisma.doctorSettlementLedger.updateMany({
      where: {
        branchId,
        clinicStaffProfileId: g.clinicStaffProfileId,
        settlementStatus: "PENDING",
        batchId: null,
        createdAt: { gte: periodStart, lte: periodEndNorm },
      },
      data: { batchId: batch.id },
    });
  }

  return batches;
}

/** List settlement batches for branch */
export async function listBatches(options: {
  branchId: number;
  clinicStaffProfileId?: number;
  status?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.clinicStaffProfileId != null)
    where.clinicStaffProfileId = options.clinicStaffProfileId;
  if (options.status != null) where.status = options.status;
  if (options.from != null || options.to != null) {
    where.periodEnd = {
      ...(options.from != null && { gte: options.from }),
      ...(options.to != null && { lte: options.to }),
    };
  }

  const [items, total] = await Promise.all([
    prisma.doctorSettlementBatch.findMany({
      where,
      skip,
      take: limit,
      include: {
        clinicStaffProfile: {
          select: {
            id: true,
            branchMember: {
              select: { user: { select: { profile: { select: { displayName: true } } } } },
            },
          },
        },
        _count: { select: { ledgerEntries: true } },
      },
      orderBy: { periodEnd: "desc" },
    }),
    prisma.doctorSettlementBatch.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Get single batch by id */
export async function getBatchById(batchId: number, branchId: number) {
  const batch = await prisma.doctorSettlementBatch.findFirst({
    where: { id: batchId, branchId },
    include: {
      clinicStaffProfile: {
        select: {
          id: true,
          branchMember: {
            select: { user: { select: { profile: { select: { displayName: true } } } } },
          },
        },
      },
      ledgerEntries: true,
      payments: true,
      adjustments: true,
    },
  });
  if (!batch) throw new Error("Settlement batch not found");
  return batch;
}

/** Mark batch as under review */
export async function reviewBatch(batchId: number, branchId: number) {
  const batch = await prisma.doctorSettlementBatch.findFirst({
    where: { id: batchId, branchId },
  });
  if (!batch) throw new Error("Settlement batch not found");
  if (batch.status !== "DRAFT")
    throw new Error("Batch can only be reviewed when in DRAFT status");

  return prisma.doctorSettlementBatch.update({
    where: { id: batchId },
    data: { status: "UNDER_REVIEW" },
  });
}

/** Approve batch (ready for payout) */
export async function approveBatch(
  batchId: number,
  branchId: number,
  approvedByUserId: number
) {
  const batch = await prisma.doctorSettlementBatch.findFirst({
    where: { id: batchId, branchId },
  });
  if (!batch) throw new Error("Settlement batch not found");
  if (batch.status !== "DRAFT" && batch.status !== "UNDER_REVIEW")
    throw new Error("Batch cannot be approved in current status");

  const updated = await prisma.doctorSettlementBatch.update({
    where: { id: batchId },
    data: {
      status: "APPROVED",
      approvedByUserId,
      approvedAt: new Date(),
    },
  });

  await prisma.settlementAuditLog.create({
    data: {
      orgId: batch.orgId,
      branchId: batch.branchId,
      action: "APPROVED",
      settlementBatchId: batchId,
      byUserId: approvedByUserId,
    },
  });

  emit(DOMAIN_EVENTS.SETTLEMENT_APPROVED, {
    batchId,
    branchId: batch.branchId,
    clinicStaffProfileId: batch.clinicStaffProfileId,
    netPayable: Number(batch.netPayable ?? 0),
    approvedByUserId,
  });

  return updated;
}

/** Record payout for batch */
export async function payBatch(
  batchId: number,
  branchId: number,
  data: {
    paymentMethod: string;
    amount: number;
    paidByUserId?: number | null;
    receiptRef?: string | null;
  }
) {
  const batch = await prisma.doctorSettlementBatch.findFirst({
    where: { id: batchId, branchId },
  });
  if (!batch) throw new Error("Settlement batch not found");
  if (batch.status !== "APPROVED")
    throw new Error("Batch must be APPROVED before payment");

  const paymentAmount =
    data.amount != null ? Number(data.amount) : Number(batch.netPayable ?? 0);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("Payment amount must be greater than 0");
  }

  await prisma.settlementPayment.create({
    data: {
      settlementBatchId: batchId,
      paymentMethod: data.paymentMethod,
      amount: paymentAmount,
      paidByUserId: data.paidByUserId ?? undefined,
      receiptRef: data.receiptRef ?? undefined,
    },
  });

  const totalPaid = await prisma.settlementPayment.aggregate({
    where: { settlementBatchId: batchId },
    _sum: { amount: true },
  });
  const sumPaid = Number(totalPaid._sum.amount ?? 0);
  const newStatus = sumPaid >= Number(batch.netPayable) ? "PAID" : "PARTIALLY_PAID";

  const updated = await prisma.doctorSettlementBatch.update({
    where: { id: batchId },
    data: {
      status: newStatus,
      ...(newStatus === "PAID" && { paidAt: new Date() }),
    },
  });

  if (newStatus === "PAID") {
    await prisma.doctorSettlementLedger.updateMany({
      where: { batchId },
      data: {
        settlementStatus: "PAID",
        settledAt: new Date(),
        settledByUserId: data.paidByUserId ?? undefined,
      },
    });
  }

  await prisma.settlementAuditLog.create({
    data: {
      orgId: batch.orgId,
      branchId: batch.branchId,
      action: "PAID",
      settlementBatchId: batchId,
      byUserId: data.paidByUserId ?? undefined,
      meta: { amount: paymentAmount, receiptRef: data.receiptRef },
    },
  });

  emit(DOMAIN_EVENTS.SETTLEMENT_PAID, {
    batchId,
    branchId: batch.branchId,
    clinicStaffProfileId: batch.clinicStaffProfileId,
    amount: paymentAmount,
    paidByUserId: data.paidByUserId ?? null,
    receiptRef: data.receiptRef ?? null,
    batchStatus: newStatus,
  });

  return updated;
}

/** Add adjustment (clawback, refund reversal, bonus) to batch */
export async function addBatchAdjustment(
  batchId: number,
  branchId: number,
  data: {
    adjustmentType: string;
    amount: number;
    reason?: string | null;
    ledgerId?: number | null;
    createdByUserId?: number | null;
  }
) {
  const batch = await prisma.doctorSettlementBatch.findFirst({
    where: { id: batchId, branchId },
  });
  if (!batch) throw new Error("Settlement batch not found");
  if (batch.status === "PAID") throw new Error("Cannot adjust paid batch");

  await prisma.settlementAdjustment.create({
    data: {
      settlementBatchId: batchId,
      ledgerId: data.ledgerId ?? undefined,
      adjustmentType: data.adjustmentType,
      amount: data.amount,
      reason: data.reason ?? undefined,
      createdByUserId: data.createdByUserId ?? undefined,
    },
  });

  const adjustments = await prisma.settlementAdjustment.aggregate({
    where: { settlementBatchId: batchId },
    _sum: { amount: true },
  });
  const totalAdj = Number(adjustments._sum.amount ?? 0);
  const netPayable = Math.max(
    0,
    Number(batch.totalAccrued) - Number(batch.totalDeductions) + totalAdj
  );

  return prisma.doctorSettlementBatch.update({
    where: { id: batchId },
    data: { totalAdjustments: totalAdj, netPayable },
  });
}

/** Get settlement summary for a doctor at branch */
export async function getSettlementSummaryForDoctor(
  clinicStaffProfileId: number,
  branchId: number,
  options?: { from?: Date; to?: Date }
) {
  const where: Record<string, unknown> = {
    clinicStaffProfileId,
    branchId,
  };
  if (options?.from != null || options?.to != null) {
    where.createdAt = {
      ...(options.from != null && { gte: options.from }),
      ...(options.to != null && { lte: options.to }),
    };
  }

  const [pendingSum, batches] = await Promise.all([
    prisma.doctorSettlementLedger.aggregate({
      where: { ...where, settlementStatus: "PENDING", batchId: null },
      _sum: { doctorShare: true },
      _count: true,
    }),
    prisma.doctorSettlementBatch.findMany({
      where: { clinicStaffProfileId, branchId },
      orderBy: { periodEnd: "desc" },
      take: 12,
    }),
  ]);

  return {
    pendingAmount: Number(pendingSum._sum.doctorShare ?? 0),
    pendingCount: pendingSum._count,
    recentBatches: batches,
  };
}
