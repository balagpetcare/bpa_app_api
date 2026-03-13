/**
 * EOD and handover — end-of-day closure validation and shift handover summary for medicine control.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

function dayRange(date?: Date | string | null): { dayStart: Date; dayEnd: Date; dayDate: Date } {
  const base = date ? new Date(date) : new Date();
  const dayStart = new Date(base);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd, dayDate: dayStart };
}

/**
 * GET eod-status: blockers for closing the day (tokens, vials, reconciliation).
 */
export async function getEodStatus(branchId: number, date?: Date | string | null): Promise<{
  date: string;
  canClose: boolean;
  blockers: string[];
  pendingTokenCount: number;
  activeVialSessionCount: number;
  reconciliationDone: boolean;
  reconciliationAcknowledged: boolean;
  reconciliationHasMismatch: boolean;
}> {
  const { dayStart, dayEnd, dayDate } = dayRange(date);
  const now = new Date();

  const [
    pendingTokens,
    activeVialsOpenedThatDay,
    reconciliation,
  ] = await Promise.all([
    prisma.injectionToken.count({
      where: {
        branchId,
        status: "PENDING",
        createdAt: { gte: dayStart, lt: dayEnd },
        expiresAt: { gt: now },
      },
    }),
    prisma.vialSession.count({
      where: {
        branchId,
        openedAt: { gte: dayStart, lt: dayEnd },
        status: { in: ["ACTIVE", "PARTIALLY_USED"] },
      },
    }),
    prisma.dailyReconciliation.findUnique({
      where: {
        branchId_reconciliationDate: { branchId, reconciliationDate: dayDate },
      },
      select: { id: true, hasMismatch: true, status: true },
    }),
  ]);

  const reconciliationDone = !!reconciliation;
  const reconciliationHasMismatch = reconciliation?.hasMismatch ?? false;
  const reconciliationAcknowledged =
    reconciliation?.status === "ACKNOWLEDGED" || (reconciliation?.status === "RECONCILED" && !reconciliationHasMismatch);

  const blockers: string[] = [];
  if (pendingTokens > 0) blockers.push(`${pendingTokens} pending injection token(s) not resolved`);
  if (activeVialsOpenedThatDay > 0) blockers.push(`${activeVialsOpenedThatDay} active vial session(s) still open`);
  if (!reconciliationDone) blockers.push("Daily reconciliation not run");
  if (reconciliationDone && reconciliationHasMismatch && !reconciliationAcknowledged) {
    blockers.push("Reconciliation has unacknowledged mismatch");
  }

  return {
    date: dayDate.toISOString().slice(0, 10),
    canClose: blockers.length === 0,
    blockers,
    pendingTokenCount: pendingTokens,
    activeVialSessionCount: activeVialsOpenedThatDay,
    reconciliationDone,
    reconciliationAcknowledged,
    reconciliationHasMismatch,
  };
}

/**
 * GET handover-summary: active vials, pending tokens, recently expired vials for shift handover.
 */
export async function getHandoverSummary(
  branchId: number,
  options?: { expiredWithinHours?: number }
): Promise<{
  activeVialSessions: Array<{ id: number; variantId: number; variantTitle: string; remainingQty: number; validUntil: string | null }>;
  pendingTokenCount: number;
  pendingTokens: Array<{ id: number; tokenCode: string; variantTitle: string; expectedDose: number }>;
  expiredVialsInWindow: Array<{ id: number; variantTitle: string; validUntil: string }>;
}> {
  const now = new Date();
  const hours = options?.expiredWithinHours ?? 24;
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const [activeSessions, pendingTokensList, pendingTokenCount, expiredInWindow] = await Promise.all([
    prisma.vialSession.findMany({
      where: {
        branchId,
        status: { in: ["ACTIVE", "PARTIALLY_USED"] },
        validUntil: { gt: now },
      },
      select: {
        id: true,
        variantId: true,
        remainingQty: true,
        validUntil: true,
        variant: { select: { title: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.injectionToken.findMany({
      where: {
        branchId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        tokenCode: true,
        expectedDose: true,
        variant: { select: { title: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    prisma.injectionToken.count({
      where: {
        branchId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
    }),
    prisma.vialSession.findMany({
      where: {
        branchId,
        validUntil: { gte: since, lt: now },
        status: { in: ["ACTIVE", "PARTIALLY_USED"] },
      },
      select: {
        id: true,
        validUntil: true,
        variant: { select: { title: true } },
      },
    }),
  ]);

  return {
    activeVialSessions: activeSessions.map((s) => ({
      id: s.id,
      variantId: s.variantId,
      variantTitle: (s.variant as any)?.title ?? "",
      remainingQty: s.remainingQty,
      validUntil: s.validUntil?.toISOString() ?? null,
    })),
    pendingTokenCount,
    pendingTokens: pendingTokensList.map((t) => ({
      id: t.id,
      tokenCode: t.tokenCode,
      variantTitle: (t.variant as any)?.title ?? "",
      expectedDose: t.expectedDose,
    })),
    expiredVialsInWindow: expiredInWindow.map((v) => ({
      id: v.id,
      variantTitle: (v.variant as any)?.title ?? "",
      validUntil: v.validUntil!.toISOString(),
    })),
  };
}
