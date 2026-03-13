/**
 * Daily Reconciliation Service
 * Branch-level anti-fraud reconciliation for injection + vial + billing trail.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as medicineIncidentService from "./medicineIncident.service";

type ListReconciliationOptions = {
  fromDate?: Date;
  toDate?: Date;
  status?: "PENDING" | "RECONCILED" | "FLAGGED" | "ACKNOWLEDGED";
  hasMismatch?: boolean;
  skip?: number;
  take?: number;
};

function dayRange(input?: Date | string | null): { dayDate: Date; dayStart: Date; dayEnd: Date } {
  const base = input ? new Date(input) : new Date();
  const dayStart = new Date(base);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayDate: dayStart, dayStart, dayEnd };
}

function toNum(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function autoReconcile(branchId: number, reconciliationDate?: Date | string | null): Promise<any> {
  if (!branchId) throw new Error("branchId is required");
  const { dayDate, dayStart, dayEnd } = dayRange(reconciliationDate);

  const administrationWhere: any = {
    administeredAt: { gte: dayStart, lt: dayEnd },
    OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
  };

  const [
    administrationAgg,
    noTokenInternalCount,
    vialOpenedAgg,
    vialClosedCount,
    billingAgg,
    tokensGenerated,
    tokensUsed,
    internalOrdersCount,
    expiredVialsCount,
    vialSessionsOpenedThatDay,
    existing,
  ] = await Promise.all([
    prisma.medicationAdministration.aggregate({
      where: administrationWhere,
      _count: { _all: true },
      _sum: { administeredDose: true },
    }),
    prisma.medicationAdministration.count({
      where: {
        ...administrationWhere,
        injectionTokenId: null,
        medicineSource: { in: ["INTERNAL", "EXTERNAL"] },
      },
    }),
    prisma.vialSession.aggregate({
      where: { branchId, openedAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
      _sum: { initialQty: true },
    }),
    prisma.vialReturn.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd }, vialSession: { branchId } },
    }),
    prisma.order.aggregate({
      where: {
        branchId,
        paymentStatus: "COMPLETED",
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { totalAmount: true },
    }),
    prisma.injectionToken.count({
      where: { branchId, createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.injectionToken.count({
      where: {
        branchId,
        status: "USED",
        usedAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    prisma.dispenseRequest.count({
      where: {
        branchId,
        createdAt: { gte: dayStart, lt: dayEnd },
        requestType: { not: "STANDARD" },
      },
    }),
    prisma.vialSessionEvent.count({
      where: {
        eventType: "EXPIRED",
        createdAt: { gte: dayStart, lt: dayEnd },
        vialSession: { branchId },
      },
    }),
    prisma.vialSession.findMany({
      where: { branchId, openedAt: { gte: dayStart, lt: dayEnd } },
      select: { id: true, initialQty: true, remainingQty: true },
    }),
    prisma.dailyReconciliation.findUnique({
      where: {
        branchId_reconciliationDate: { branchId, reconciliationDate: dayDate },
      },
      select: { id: true, status: true },
    }),
  ]);

  const totalInjections = administrationAgg._count?._all ?? 0;
  const totalMlUsed = toNum(administrationAgg._sum?.administeredDose);
  const vialsOpened = vialOpenedAgg._count?._all ?? 0;
  const openedCapacityMl = toNum(vialOpenedAgg._sum?.initialQty);
  const avgVialCapacity = vialsOpened > 0 ? openedCapacityMl / vialsOpened : 0;
  const expectedVialsConsumed = avgVialCapacity > 0 ? totalMlUsed / avgVialCapacity : 0;
  const totalBillingCollected = toNum(billingAgg._sum?.totalAmount);
  const tokensUnused = Math.max(0, tokensGenerated - tokensUsed);

  const totalInternalOrders = internalOrdersCount ?? 0;
  const totalExpiredVials = expiredVialsCount ?? 0;
  const deductedFromSessions =
    vialSessionsOpenedThatDay?.reduce(
      (sum, s) => sum + (toNum(s.initialQty) - toNum(s.remainingQty)),
      0
    ) ?? 0;

  const mismatchDetails: Record<string, any> = {
    _summary: { totalInternalOrders, totalExpiredVials },
  };
  if (tokensUsed !== totalInjections) {
    mismatchDetails.tokenInjectionCountMismatch = {
      tokensUsed,
      totalInjections,
      reason: "Used token count does not match recorded injections",
    };
  }
  if (noTokenInternalCount > 0) {
    mismatchDetails.noTokenInternalAdministrations = {
      count: noTokenInternalCount,
      reason: "Internal/external source injections exist without token linkage",
    };
  }
  if (openedCapacityMl > 0 && totalMlUsed > openedCapacityMl) {
    mismatchDetails.vialCapacityMismatch = {
      totalMlUsed,
      openedCapacityMl,
      reason: "Total administered ml exceeds opened vial capacity for the day",
    };
  }
  if (tokensUnused > 0) {
    mismatchDetails.unusedTokens = {
      tokensGenerated,
      tokensUsed,
      tokensUnused,
      reason: "Generated tokens not fully consumed",
    };
  }
  if (Math.abs(deductedFromSessions - totalMlUsed) > 0.01 && vialSessionsOpenedThatDay?.length) {
    mismatchDetails.usedMlVsRemainingMismatch = {
      totalMlUsed,
      deductedFromSessions,
      reason: "Total used ml does not match (initial - remaining) from vials opened today",
    };
  }

  const hasMismatch =
    !!mismatchDetails.tokenInjectionCountMismatch ||
    !!mismatchDetails.noTokenInternalAdministrations ||
    !!mismatchDetails.vialCapacityMismatch ||
    !!mismatchDetails.unusedTokens ||
    !!mismatchDetails.usedMlVsRemainingMismatch;
  const computedStatus = hasMismatch ? "FLAGGED" : "RECONCILED";
  const resolvedStatus =
    existing?.status === "ACKNOWLEDGED" && hasMismatch ? "ACKNOWLEDGED" : computedStatus;

  const result = await prisma.dailyReconciliation.upsert({
    where: {
      branchId_reconciliationDate: { branchId, reconciliationDate: dayDate },
    },
    create: {
      branchId,
      reconciliationDate: dayDate,
      totalInjections,
      totalMlUsed,
      vialsOpened,
      vialsClosed: vialClosedCount,
      expectedVialsConsumed,
      totalBillingCollected,
      tokensGenerated,
      tokensUsed,
      tokensUnused,
      hasMismatch,
      mismatchDetails,
      status: resolvedStatus,
    },
    update: {
      totalInjections,
      totalMlUsed,
      vialsOpened,
      vialsClosed: vialClosedCount,
      expectedVialsConsumed,
      totalBillingCollected,
      tokensGenerated,
      tokensUsed,
      tokensUnused,
      hasMismatch,
      mismatchDetails,
      status: resolvedStatus,
    },
    include: {
      branch: { select: { id: true, name: true, orgId: true } },
      reconciledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (hasMismatch && result.branch?.orgId) {
    try {
      await medicineIncidentService.raiseIncident({
        orgId: result.branch.orgId,
        branchId,
        incidentType: "REPEATED_VIAL_MISMATCH",
        relatedEntityType: "DailyReconciliation",
        relatedEntityId: String(result.id),
        severity: "MEDIUM",
      });
    } catch (_) {
      // avoid failing reconciliation if incident raise fails
    }
  }
  return result;
}

export async function listReconciliations(branchId: number, opts?: ListReconciliationOptions): Promise<{ list: any[]; total: number }> {
  if (!branchId) throw new Error("branchId is required");
  const where: any = { branchId };

  if (opts?.status) where.status = opts.status;
  if (opts?.hasMismatch != null) where.hasMismatch = opts.hasMismatch;
  if (opts?.fromDate || opts?.toDate) {
    where.reconciliationDate = {};
    if (opts?.fromDate) where.reconciliationDate.gte = dayRange(opts.fromDate).dayDate;
    if (opts?.toDate) where.reconciliationDate.lte = dayRange(opts.toDate).dayDate;
  }

  const [list, total] = await Promise.all([
    prisma.dailyReconciliation.findMany({
      where,
      orderBy: { reconciliationDate: "desc" },
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 30, 100),
      include: {
        reconciledBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.dailyReconciliation.count({ where }),
  ]);

  return { list, total };
}

export async function getReconciliationByDate(branchId: number, reconciliationDate?: Date | string | null): Promise<any> {
  if (!branchId) throw new Error("branchId is required");
  const { dayDate } = dayRange(reconciliationDate);
  return prisma.dailyReconciliation.findUnique({
    where: { branchId_reconciliationDate: { branchId, reconciliationDate: dayDate } },
    include: {
      branch: { select: { id: true, name: true } },
      reconciledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

export async function acknowledgeMismatch(
  branchId: number,
  reconciliationId: number,
  acknowledgedByUserId: number,
  note?: string | null
): Promise<any> {
  if (!branchId || !reconciliationId || !acknowledgedByUserId) {
    throw new Error("branchId, reconciliationId and acknowledgedByUserId are required");
  }

  const row = await prisma.dailyReconciliation.findFirst({
    where: { id: reconciliationId, branchId },
    select: { id: true, mismatchDetails: true, hasMismatch: true },
  });
  if (!row) throw new Error("Daily reconciliation not found");

  const details =
    row.mismatchDetails && typeof row.mismatchDetails === "object"
      ? (row.mismatchDetails as Record<string, any>)
      : {};

  details.managerAcknowledgement = {
    acknowledgedByUserId,
    acknowledgedAt: new Date().toISOString(),
    note: note ?? null,
  };

  return prisma.dailyReconciliation.update({
    where: { id: reconciliationId },
    data: {
      status: "ACKNOWLEDGED",
      reconciledByUserId: acknowledgedByUserId,
      mismatchDetails: details,
      hasMismatch: row.hasMismatch,
    },
    include: {
      reconciledBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

