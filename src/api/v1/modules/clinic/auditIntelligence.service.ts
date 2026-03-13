/**
 * Audit Intelligence Service (CCMLPA) — variance, risk score, compliance, leakage trend.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

function dayRange(input?: Date | string | null): { dayStart: Date; dayEnd: Date } {
  const base = input ? new Date(input) : new Date();
  const dayStart = new Date(base);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

function n(v: any): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function getBranchManagerDashboard(branchId: number): Promise<any> {
  const { dayStart } = dayRange();
  const now = new Date();
  const { dayEnd } = dayRange();

  const [issuedToday, unresolvedReturns, activeSessions, pendingApprovals, tokensGenerated, tokensUsed, injectionsToday, latestReconciliation, flaggedReconciliations] = await Promise.all([
    prisma.dispenseRequest.count({ where: { branchId, status: { in: ["ISSUED", "PARTIALLY_ISSUED"] }, createdAt: { gte: dayStart } } }),
    prisma.vialReturn.count({ where: { verificationStatus: "PENDING" } }),
    prisma.vialSession.count({ where: { branchId, status: { in: ["ACTIVE", "PARTIALLY_USED"] }, validUntil: { gt: now } } }),
    prisma.medicineApprovalRequest.count({ where: { branchId, status: "PENDING" } }),
    prisma.injectionToken.count({ where: { branchId, createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.injectionToken.count({ where: { branchId, status: "USED", usedAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.medicationAdministration.count({
      where: {
        administeredAt: { gte: dayStart, lt: dayEnd },
        OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
      },
    }),
    prisma.dailyReconciliation.findFirst({
      where: { branchId },
      orderBy: { reconciliationDate: "desc" },
    }),
    prisma.dailyReconciliation.count({
      where: { branchId, hasMismatch: true, status: { in: ["FLAGGED", "PENDING"] } },
    }),
  ]);
  return {
    issuedToday,
    unresolvedReturns,
    activeSessions,
    pendingApprovals,
    injectionMonitor: {
      tokensGenerated,
      tokensUsed,
      tokensUnused: Math.max(0, tokensGenerated - tokensUsed),
      injectionsToday,
    },
    reconciliation: {
      latest: latestReconciliation,
      flaggedOpen: flaggedReconciliations,
    },
  };
}

export async function getPharmacyDashboard(branchId: number): Promise<any> {
  const [pendingRequests, approvedNotIssued, openBins] = await Promise.all([
    prisma.dispenseRequest.count({ where: { branchId, status: "PENDING" } }),
    prisma.dispenseRequest.count({ where: { branchId, status: "APPROVED" } }),
    prisma.auditBin.count({ where: { branchId, status: "OPEN" } }),
  ]);
  return { pendingRequests, approvedNotIssued, openBins };
}

export async function getAuditorDashboard(branchId: number): Promise<any> {
  const [quarantinedReturns, openIncidents, binsSealed] = await Promise.all([
    prisma.vialReturn.count({ where: { vialSession: { branchId }, verificationStatus: "QUARANTINED" } }),
    prisma.medicineIncident.count({ where: { branchId, status: { in: ["OPEN", "INVESTIGATING"] } } }),
    prisma.auditBin.count({ where: { branchId, status: "SEALED" } }),
  ]);
  return { quarantinedReturns, openIncidents, binsSealed };
}

export async function getOwnerDashboard(orgId: number): Promise<any> {
  const branches = await prisma.branch.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const summary = {
    branches: branches.length,
    totalPendingApprovals: await prisma.medicineApprovalRequest.count({ where: { orgId, status: "PENDING" } }),
    totalOpenIncidents: await prisma.medicineIncident.count({ where: { orgId, status: { in: ["OPEN", "INVESTIGATING"] } } }),
  };
  return summary;
}

export async function getInjectionMonitoringDashboard(branchId: number, forDate?: Date | string | null): Promise<any> {
  const { dayStart, dayEnd } = dayRange(forDate);
  const now = new Date();

  const [tokenStatusCounts, administrationAgg, administrationBySource, activeVials, pendingTokenList, latestReconciliation] = await Promise.all([
    prisma.injectionToken.groupBy({
      by: ["status"],
      where: { branchId, createdAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
    }),
    prisma.medicationAdministration.aggregate({
      where: {
        administeredAt: { gte: dayStart, lt: dayEnd },
        OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
      },
      _count: { _all: true },
      _sum: { administeredDose: true },
    }),
    prisma.medicationAdministration.groupBy({
      by: ["medicineSource"],
      where: {
        administeredAt: { gte: dayStart, lt: dayEnd },
        OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
      },
      _count: { _all: true },
      _sum: { administeredDose: true },
    }),
    prisma.vialSession.findMany({
      where: { branchId, status: { in: ["ACTIVE", "PARTIALLY_USED"] }, validUntil: { gt: now } },
      select: {
        id: true,
        variantId: true,
        remainingQty: true,
        initialQty: true,
        openedAt: true,
        validUntil: true,
        variant: { select: { id: true, title: true, sku: true } },
      },
      orderBy: { openedAt: "desc" },
      take: 20,
    }),
    prisma.injectionToken.findMany({
      where: { branchId, status: "PENDING" },
      select: {
        id: true,
        tokenCode: true,
        visitId: true,
        patientId: true,
        variantId: true,
        expectedDose: true,
        unit: true,
        medicineSource: true,
        createdAt: true,
        expiresAt: true,
        variant: { select: { id: true, title: true, sku: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.dailyReconciliation.findFirst({
      where: { branchId, reconciliationDate: { gte: dayStart, lt: dayEnd } },
      orderBy: { reconciliationDate: "desc" },
    }),
  ]);

  const tokenSummary = {
    PENDING: 0,
    USED: 0,
    EXPIRED: 0,
    CANCELLED: 0,
  } as Record<string, number>;
  for (const row of tokenStatusCounts) tokenSummary[row.status] = row._count._all;

  const sourceSummary: Record<string, { count: number; totalMl: number }> = {};
  for (const row of administrationBySource) {
    sourceSummary[row.medicineSource] = {
      count: row._count._all,
      totalMl: n(row._sum?.administeredDose),
    };
  }

  return {
    date: dayStart,
    tokens: tokenSummary,
    administrations: {
      count: administrationAgg._count?._all ?? 0,
      totalMlUsed: n(administrationAgg._sum?.administeredDose),
      bySource: sourceSummary,
    },
    activeVials,
    pendingTokens: pendingTokenList,
    reconciliation: latestReconciliation,
  };
}

const pendingTokenSelect = {
  id: true,
  tokenCode: true,
  visitId: true,
  patientId: true,
  variantId: true,
  expectedDose: true,
  unit: true,
  medicineSource: true,
  createdAt: true,
  expiresAt: true,
  selectedVialSessionId: true,
  validatedByUserId: true,
  variant: { select: { id: true, title: true, sku: true } },
  visit: { select: { id: true, treatmentCode: true } },
  selectedVialSession: {
    select: {
      id: true,
      roomId: true,
      room: { select: { id: true, name: true, code: true } },
    },
  },
  validatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
};

/** Injection room operations board: pending, completed today, bypass cases, expired/problem tokens. Optional roomId; validatedByUserId filters pending/unassigned; administeredByUserId filters completedToday and bypassToday. */
export async function getInjectionRoomBoard(
  branchId: number,
  forDate?: Date | string | null,
  roomId?: number | null,
  validatedByUserId?: number | null,
  administeredByUserId?: number | null
): Promise<{
  date: Date;
  pendingTokens: any[];
  unassignedTokens: any[];
  completedToday: any[];
  bypassToday: any[];
  expiredOrProblemToday: any[];
}> {
  const { dayStart, dayEnd } = dayRange(forDate);

  const basePendingWhere: any = { branchId, status: "PENDING" };
  if (validatedByUserId != null) basePendingWhere.validatedByUserId = validatedByUserId;

  const pendingWhere: any = { ...basePendingWhere };
  if (roomId != null) {
    pendingWhere.selectedVialSessionId = { not: null };
    pendingWhere.selectedVialSession = { roomId };
  }

  const unassignedWhere: any = { ...basePendingWhere, selectedVialSessionId: null };

  const completedWhere: any = {
    administeredAt: { gte: dayStart, lt: dayEnd },
    OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
  };
  if (administeredByUserId != null) completedWhere.administeredByUserId = administeredByUserId;

  const bypassWhere: any = {
    administeredAt: { gte: dayStart, lt: dayEnd },
    emergencyBypassReason: { not: null },
    OR: [{ visit: { branchId } }, { vialSession: { branchId } }],
  };
  if (administeredByUserId != null) bypassWhere.administeredByUserId = administeredByUserId;

  const [pendingTokens, unassignedTokens, completedToday, bypassToday, expiredOrProblemToday] = await Promise.all([
    prisma.injectionToken.findMany({
      where: pendingWhere,
      select: pendingTokenSelect,
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.injectionToken.findMany({
      where: unassignedWhere,
      select: pendingTokenSelect,
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.medicationAdministration.findMany({
      where: completedWhere,
      select: {
        id: true,
        visitId: true,
        variantId: true,
        administeredDose: true,
        unit: true,
        medicineSource: true,
        administeredAt: true,
        emergencyBypassReason: true,
        variant: { select: { id: true, title: true, sku: true } },
        visit: { select: { id: true, treatmentCode: true } },
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        administeredBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { administeredAt: "desc" },
      take: 100,
    }),
    prisma.medicationAdministration.findMany({
      where: bypassWhere,
      select: {
        id: true,
        visitId: true,
        variantId: true,
        administeredDose: true,
        unit: true,
        administeredAt: true,
        emergencyBypassReason: true,
        variant: { select: { id: true, title: true } },
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        administeredBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { administeredAt: "desc" },
      take: 50,
    }),
    prisma.injectionToken.findMany({
      where: {
        branchId,
        status: { in: ["EXPIRED", "CANCELLED"] },
        OR: [
          { createdAt: { gte: dayStart, lt: dayEnd } },
          { cancelledAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
      select: {
        id: true,
        tokenCode: true,
        status: true,
        visitId: true,
        variantId: true,
        expectedDose: true,
        unit: true,
        createdAt: true,
        expiresAt: true,
        cancelReason: true,
        variant: { select: { id: true, title: true } },
        visit: { select: { id: true, treatmentCode: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return {
    date: dayStart,
    pendingTokens,
    unassignedTokens,
    completedToday,
    bypassToday,
    expiredOrProblemToday,
  };
}
