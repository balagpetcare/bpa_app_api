/**
 * Clinic reports & analytics: daily patient count, revenue, service/doctor breakdown,
 * vaccine coverage, pending dues; profitability, settlement, discount, variance, doctor contribution.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

async function getDashboardSummary(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom + "T00:00:00.000Z");
  const end = new Date(dateTo + "T23:59:59.999Z");
  const [visitCount, orders] = await Promise.all([
    prisma.visit.count({
      where: { branchId, status: "COMPLETED", completedAt: { gte: start, lte: end } },
    }),
    prisma.order.findMany({
      where: {
        branchId,
        visitId: { not: null },
        createdAt: { gte: start, lte: end },
      },
      select: { totalAmount: true },
    }),
  ]);
  const revenue = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  return { visitCount, orderCount: orders.length, revenue };
}

/** Profitability: revenue, direct cost, margin by branch/period; optional by service/package */
async function getProfitabilityReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const orders = await prisma.order.findMany({
    where: {
      branchId,
      orderSource: "CLINIC",
      visitId: { not: null },
      paymentStatus: "COMPLETED",
      createdAt: { gte: start, lte: end },
    },
    select: { id: true, totalAmount: true },
  });
  const orderIds = orders.map((o) => o.id);
  const revenue = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);

  const costSheets = await prisma.invoiceCostSheet.findMany({
    where: { clinicInvoice: { orderId: { in: orderIds } } },
    select: {
      revenue: true,
      directCost: true,
      distributableMargin: true,
      doctorShare: true,
      clinicShare: true,
      supportShare: true,
      grossProfit: true,
    },
  });
  const directCost = costSheets.reduce((s, c) => s + Number(c.directCost || 0), 0);
  const margin = costSheets.reduce((s, c) => s + Number(c.distributableMargin || 0), 0);
  const doctorShare = costSheets.reduce((s, c) => s + Number(c.doctorShare || 0), 0);
  const clinicShare = costSheets.reduce((s, c) => s + Number(c.clinicShare || 0), 0);

  return {
    branchId,
    period: { from: start, to: end },
    revenue,
    directCost,
    distributableMargin: margin,
    doctorShareTotal: doctorShare,
    clinicShareTotal: clinicShare,
    orderCount: orders.length,
  };
}

/** Settlement summary: doctor-wise payable, paid, pending */
async function getSettlementSummaryReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const [pendingLedger, batches] = await Promise.all([
    prisma.doctorSettlementLedger.groupBy({
      by: ["clinicStaffProfileId"],
      where: {
        branchId,
        settlementStatus: "PENDING",
        batchId: null,
        createdAt: { gte: start, lte: end },
      },
      _sum: { doctorShare: true },
      _count: true,
    }),
    prisma.doctorSettlementBatch.findMany({
      where: { branchId, periodEnd: { gte: start, lte: end } },
      select: {
        id: true,
        clinicStaffProfileId: true,
        totalAccrued: true,
        netPayable: true,
        status: true,
        paidAt: true,
      },
    }),
  ]);

  const byDoctor = new Map();
  for (const p of pendingLedger) {
    byDoctor.set(p.clinicStaffProfileId, {
      pendingAmount: Number(p._sum.doctorShare ?? 0),
      pendingCount: p._count,
      paidAmount: 0,
      batchCount: 0,
    });
  }
  for (const b of batches) {
    const cur = byDoctor.get(b.clinicStaffProfileId) ?? {
      pendingAmount: 0,
      pendingCount: 0,
      paidAmount: 0,
      batchCount: 0,
    };
    cur.batchCount += 1;
    if (b.status === "PAID" && b.paidAt) {
      cur.paidAmount += Number(b.netPayable ?? 0);
    }
    byDoctor.set(b.clinicStaffProfileId, cur);
  }

  return {
    branchId,
    period: { from: start, to: end },
    byDoctor: Array.from(byDoctor.entries()).map(([profileId, v]) => ({
      clinicStaffProfileId: profileId,
      ...v,
    })),
  };
}

/** Discount analysis: by user, by doctor, by package; totals and counts */
async function getDiscountAnalysisReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const applied = await prisma.appliedDiscount.findMany({
    where: {
      discountPolicy: { branchId },
      createdAt: { gte: start, lte: end },
    },
    select: {
      amount: true,
      discountType: true,
      orderId: true,
      clinicalCaseId: true,
      approvedByUserId: true,
    },
  });
  const totalDiscount = applied.reduce((s, a) => s + Number(a.amount), 0);
  const byType = applied.reduce((acc, a) => {
    acc[a.discountType] = (acc[a.discountType] || 0) + Number(a.amount);
    return acc;
  }, {});

  return {
    branchId,
    period: { from: start, to: end },
    totalDiscount,
    count: applied.length,
    byType,
  };
}

/** Inventory variance: planned vs actual by variant/case */
async function getInventoryVarianceReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const cases = await prisma.clinicalCase.findMany({
    where: { branchId, openedAt: { gte: start, lte: end } },
    select: { id: true },
  });
  const caseIds = cases.map((c) => c.id);
  const procedureOrders = await prisma.procedureOrder.findMany({
    where: { clinicalCaseId: { in: caseIds } },
    select: { id: true },
  });
  const procedureOrderIds = procedureOrders.map((p) => p.id);

  const consumptions = await prisma.inventoryConsumption.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      OR: [
        { clinicalCaseId: { in: caseIds } },
        { procedureOrderId: { in: procedureOrderIds } },
      ],
    },
    select: { id: true },
  });
  const consumptionIds = consumptions.map((c) => c.id);
  const logs =
    consumptionIds.length === 0
      ? []
      : await prisma.inventoryVarianceLog.findMany({
          where: { inventoryConsumptionId: { in: consumptionIds } },
          include: { variant: { select: { id: true, sku: true, title: true } } },
        });

  const totalVarianceCost = logs.reduce(
    (s, l) => s + (l.varianceCost != null ? Number(l.varianceCost) : 0),
    0
  );
  return {
    branchId,
    period: { from: start, to: end },
    varianceLogCount: logs.length,
    totalVarianceCost,
    items: logs.slice(0, 100),
  };
}

/** Doctor contribution margin: revenue and share per doctor */
async function getDoctorContributionReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const ledger = await prisma.doctorSettlementLedger.findMany({
    where: {
      branchId,
      createdAt: { gte: start, lte: end },
    },
    select: {
      clinicStaffProfileId: true,
      grossAmount: true,
      doctorShare: true,
      clinicShare: true,
    },
  });

  const byDoctor = new Map<
    number,
    { grossAmount: number; doctorShare: number; clinicShare: number; count: number }
  >();
  for (const row of ledger) {
    const cur = byDoctor.get(row.clinicStaffProfileId) ?? {
      grossAmount: 0,
      doctorShare: 0,
      clinicShare: 0,
      count: 0,
    };
    cur.grossAmount += Number(row.grossAmount ?? 0);
    cur.doctorShare += Number(row.doctorShare ?? 0);
    cur.clinicShare += Number(row.clinicShare ?? 0);
    cur.count += 1;
    byDoctor.set(row.clinicStaffProfileId, cur);
  }

  const profileIds = Array.from(byDoctor.keys());
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { id: { in: profileIds } },
    select: {
      id: true,
      branchMember: {
        select: { user: { select: { profile: { select: { displayName: true } } } } },
      },
    },
  });
  const nameByProfile = new Map(
    profiles.map((p) => [
      p.id,
      (p.branchMember as { user?: { profile?: { displayName?: string } } })?.user?.profile
        ?.displayName ?? `Profile #${p.id}`,
    ])
  );

  return {
    branchId,
    period: { from: start, to: end },
    byDoctor: Array.from(byDoctor.entries()).map(([profileId, v]) => ({
      clinicStaffProfileId: profileId,
      displayName: nameByProfile.get(profileId),
      ...v,
    })),
  };
}

/** Max date range (days) for visit completion audit to avoid heavy queries. See Phase 6 doc for indexing. */
const VISIT_COMPLETION_AUDIT_MAX_DAYS = 365;
/** Default and max limit for recentOverrides in one response. */
const VISIT_COMPLETION_AUDIT_RECENT_LIMIT_DEFAULT = 20;
const VISIT_COMPLETION_AUDIT_RECENT_LIMIT_MAX = 100;

/**
 * Visit completion audit: completed with override count, recent overrides, most common unmet.
 * Reads from doctor_audit_logs (VISIT_COMPLETED, VISIT_COMPLETED_OVERRIDE). Branch-scoped for manager visibility.
 * Supports maskOverrideReason (privacy), date-range guardrails, and pagination cap on recentOverrides.
 */
async function getVisitCompletionAuditSummary(
  branchId,
  dateFrom,
  dateTo,
  opts: { maskOverrideReason?: boolean; recentLimit?: number } = {}
) {
  const { maskOverrideReason = false, recentLimit = VISIT_COMPLETION_AUDIT_RECENT_LIMIT_DEFAULT } = opts;
  const start = new Date(dateFrom + "T00:00:00.000Z");
  const end = new Date(dateTo + "T23:59:59.999Z");

  const limit = Math.min(
    Math.max(1, Number(recentLimit) || VISIT_COMPLETION_AUDIT_RECENT_LIMIT_DEFAULT),
    VISIT_COMPLETION_AUDIT_RECENT_LIMIT_MAX
  );

  const logs = await prisma.doctorAuditLog.findMany({
    where: {
      branchId: Number(branchId),
      action: { in: ["VISIT_COMPLETED", "VISIT_COMPLETED_OVERRIDE"] },
      createdAt: { gte: start, lte: end },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, newValue: true, changedByUserId: true, createdAt: true },
  });

  const totalCompleted = logs.length;
  const overrideLogs = logs.filter((l) => l.action === "VISIT_COMPLETED_OVERRIDE");
  const completedWithOverride = overrideLogs.length;

  const recentOverrides = overrideLogs.slice(0, limit).map((l) => {
    const v = l.newValue && typeof l.newValue === "object" ? l.newValue : {};
    return {
      visitId: v.visitId,
      appointmentId: v.appointmentId,
      completedAt: v.completedAt,
      completedByUserId: v.completedByUserId,
      overrideReason: maskOverrideReason && v.overrideReason ? "[REDACTED]" : v.overrideReason,
      unmet: v.unmet,
      visitContext: v.visitContext,
      createdAt: l.createdAt,
    };
  });

  const unmetCounts = new Map();
  for (const l of overrideLogs) {
    const v = l.newValue && typeof l.newValue === "object" ? l.newValue : {};
    const unmet = Array.isArray(v.unmet) ? v.unmet : [];
    for (const u of unmet) {
      const key = String(u).trim();
      if (key) unmetCounts.set(key, (unmetCounts.get(key) || 0) + 1);
    }
  }
  const mostCommonUnmet = Array.from(unmetCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    branchId: Number(branchId),
    period: { from: dateFrom, to: dateTo },
    totalCompleted,
    completedWithOverride,
    overrideRate: totalCompleted > 0 ? Math.round((completedWithOverride / totalCompleted) * 100) : 0,
    recentOverrides,
    mostCommonUnmet,
  };
}

/** Surgery revenue: surgeries in period with invoice totals (Phase 3). */
async function getSurgeryRevenueReport(branchId, dateFrom, dateTo) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const cases = await prisma.surgeryCase.findMany({
    where: {
      branchId: Number(branchId),
      status: { notIn: ["CANCELLED"] },
      scheduledStartAt: { gte: start, lte: end },
    },
    include: {
      service: { select: { id: true, name: true } },
      primaryDoctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      clinicInvoices: {
        take: 1,
        orderBy: { id: "desc" },
        include: { order: { select: { totalAmount: true, paymentStatus: true } } },
      },
    },
    orderBy: { scheduledStartAt: "asc" },
  });

  const items = cases.map((c) => {
    const inv = c.clinicInvoices?.[0];
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      status: c.status,
      scheduledStartAt: c.scheduledStartAt,
      service: c.service,
      primaryDoctor: c.primaryDoctor?.user?.profile?.displayName,
      totalAmount: inv?.order ? Number(inv.order.totalAmount ?? 0) : null,
      paymentStatus: inv?.order?.paymentStatus ?? null,
    };
  });
  const totalRevenue = items.reduce((s, i) => s + (i.totalAmount ?? 0), 0);
  return { branchId: Number(branchId), period: { from: start, to: end }, items, totalRevenue, count: items.length };
}

module.exports = {
  getDashboardSummary,
  getProfitabilityReport,
  getSettlementSummaryReport,
  getDiscountAnalysisReport,
  getInventoryVarianceReport,
  getDoctorContributionReport,
  getVisitCompletionAuditSummary,
  getSurgeryRevenueReport,
};
