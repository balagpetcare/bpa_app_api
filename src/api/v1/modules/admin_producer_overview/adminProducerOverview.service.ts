const prisma = require("../../../../infrastructure/db/prismaClient");
const redis = require("../../../../utils/redis");

const CACHE_TTL = 300;
const CACHE_PREFIX = "apo";

import type {
  OverviewSummaryResponse,
  OverviewTrendsResponse,
  OverviewTopProducersResponse,
  OverviewAlertsResponse,
} from "./adminProducerOverview.types";

function cacheKey(endpoint: string, dateFrom: string, dateTo: string): string {
  return `${CACHE_PREFIX}:${endpoint}:${dateFrom}:${dateTo}`;
}

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // bypass cache on error
  }
  return null;
}

async function setCache(key: string, data: unknown): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(data), "EX", CACHE_TTL);
  } catch {
    // ignore
  }
}

/** Producer owner KYC: users who own at least one ProducerOrg */
async function getProducerOwnerUserIds(): Promise<number[]> {
  const rows = await prisma.producerOrg.findMany({
    select: { ownerUserId: true },
    distinct: ["ownerUserId"],
  });
  return rows.map((r) => r.ownerUserId);
}

export async function getSummary(
  _dateFrom: string,
  _dateTo: string
): Promise<OverviewSummaryResponse> {
  const key = cacheKey("summary", _dateFrom, _dateTo);
  const cached = await getCached<OverviewSummaryResponse>(key);
  if (cached) return cached;

  const producerOwnerIds = await getProducerOwnerUserIds();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(todayStart);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalProducers,
    activeProducers,
    suspendedProducers,
    pendingKYC,
    approvedKYC,
    rejectedKYC,
    pendingApprovals,
    totalProducts,
    approvedProducts,
    totalBatches,
    printedBatchesCount,
    printedAgg,
    printedToday,
    printed7d,
    printed30d,
    verifiedTotal,
    verifiedToday,
    verified7d,
    verified30d,
    openIncidents,
    resolvedIncidents,
  ] = await Promise.all([
    prisma.producerOrg.count(),
    prisma.producerOrg.count({ where: { status: "VERIFIED" } }),
    prisma.producerOrg.count({ where: { status: "SUSPENDED" } }),
    producerOwnerIds.length
      ? prisma.ownerKyc.count({
          where: {
            userId: { in: producerOwnerIds },
            verificationStatus: "SUBMITTED",
          },
        })
      : 0,
    producerOwnerIds.length
      ? prisma.ownerKyc.count({
          where: {
            userId: { in: producerOwnerIds },
            verificationStatus: "VERIFIED",
          },
        })
      : 0,
    producerOwnerIds.length
      ? prisma.ownerKyc.count({
          where: {
            userId: { in: producerOwnerIds },
            verificationStatus: "REJECTED",
          },
        })
      : 0,
    prisma.producerApproval.count({ where: { status: "SUBMITTED" } }),
    prisma.authProduct.count(),
    prisma.authProduct.count({
      where: { status: { in: ["APPROVED", "ACTIVE"] } },
    }),
    prisma.authBatch.count(),
    prisma.authBatch.count({ where: { printedAt: { not: null } } }),
    prisma.batchSerialState.aggregate({
      _sum: { allocatedCount: true },
    }),
    prisma.authCode.count({
      where: { printedAt: { gte: todayStart } },
    }),
    prisma.authCode.count({
      where: { printedAt: { gte: sevenDaysAgo } },
    }),
    prisma.authCode.count({
      where: { printedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.authVerificationLog.count({ where: { codeId: { not: null } } }),
    prisma.authVerificationLog.count({
      where: { codeId: { not: null }, createdAt: { gte: todayStart } },
    }),
    prisma.authVerificationLog.count({
      where: { codeId: { not: null }, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.authVerificationLog.count({
      where: { codeId: { not: null }, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.complaintCase.count({ where: { resolvedAt: null } }),
    prisma.complaintCase.count({ where: { resolvedAt: { not: null } } }),
  ]);

  const unapprovedProducts = totalProducts - approvedProducts;
  const unprintedBatches = totalBatches - printedBatchesCount;
  const printedCodes30d = printed30d;
  const verifiedCodes30d = verified30d;
  const verificationSuccessRate =
    printedCodes30d > 0 ? (verifiedCodes30d / printedCodes30d) * 100 : null;

  const result: OverviewSummaryResponse = {
    totalProducers,
    activeProducers,
    suspendedProducers,
    pendingKYC,
    approvedKYC,
    rejectedKYC,
    pendingApprovals,
    totalProducts,
    approvedProducts,
    unapprovedProducts,
    totalBatches,
    printedBatches: printedBatchesCount,
    unprintedBatches,
    printedCodesToday: printedToday,
    printedCodes7d: printed7d,
    printedCodes30d: printed30d,
    verifiedCodesToday: verifiedToday,
    verifiedCodes7d: verified7d,
    verifiedCodes30d: verified30d,
    verificationSuccessRate,
    openIncidents,
    resolvedIncidents,
    lastUpdatedAt: new Date().toISOString(),
  };
  await setCache(key, result);
  return result;
}

export async function getTrends(
  dateFrom: string,
  dateTo: string
): Promise<OverviewTrendsResponse> {
  const key = cacheKey("trends", dateFrom, dateTo);
  const cached = await getCached<OverviewTrendsResponse>(key);
  if (cached) return cached;

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  type VerRow = { date: Date; verified: bigint };
  const verRows = await prisma.$queryRaw<VerRow[]>`
    SELECT DATE(avl."createdAt") as date, COUNT(*)::int as verified
    FROM auth_verification_logs avl
    WHERE avl."codeId" IS NOT NULL
      AND avl."createdAt" >= ${from}
      AND avl."createdAt" <= ${to}
    GROUP BY DATE(avl."createdAt")
    ORDER BY date
  `;

  type ApprSubRow = { date: Date; submitted: bigint };
  const apprSubRows = await prisma.$queryRaw<ApprSubRow[]>`
    SELECT DATE(pa."createdAt") as date, COUNT(*)::int as submitted
    FROM producer_approvals pa
    WHERE pa."createdAt" >= ${from} AND pa."createdAt" <= ${to}
    GROUP BY DATE(pa."createdAt")
    ORDER BY date
  `;
  type ApprRevRow = { date: Date; approved: bigint; rejected: bigint };
  const apprRevRows = await prisma.$queryRaw<ApprRevRow[]>`
    SELECT DATE(pa."reviewedAt") as date,
      COUNT(*) FILTER (WHERE pa."status" = 'APPROVED')::int as approved,
      COUNT(*) FILTER (WHERE pa."status" = 'REJECTED')::int as rejected
    FROM producer_approvals pa
    WHERE pa."reviewedAt" >= ${from} AND pa."reviewedAt" <= ${to}
    GROUP BY DATE(pa."reviewedAt")
    ORDER BY date
  `;
  const submittedByDate = new Map(
    apprSubRows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, Number(r.submitted)];
    })
  );
  const reviewedByDate = new Map(
    apprRevRows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, { approved: Number(r.approved), rejected: Number(r.rejected) }];
    })
  );

  type IncRow = { date: Date; incidents: bigint };
  const incRows = await prisma.$queryRaw<IncRow[]>`
    SELECT DATE(cc."createdAt") as date, COUNT(*)::int as incidents
    FROM complaint_cases cc
    WHERE cc."createdAt" >= ${from} AND cc."createdAt" <= ${to}
    GROUP BY DATE(cc."createdAt")
    ORDER BY date
  `;
  type SusRow = { date: Date; suspensions: bigint };
  const susRows = await prisma.$queryRaw<SusRow[]>`
    SELECT DATE(po."updatedAt") as date, COUNT(*)::int as suspensions
    FROM producer_orgs po
    WHERE po."updatedAt" >= ${from} AND po."updatedAt" <= ${to} AND po.status = 'SUSPENDED'
    GROUP BY DATE(po."updatedAt")
    ORDER BY date
  `;
  const incidentsByDate = new Map(
    incRows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, Number(r.incidents)];
    })
  );
  const suspensionsByDate = new Map(
    susRows.map((r) => {
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      return [d, Number(r.suspensions)];
    })
  );

  const toStr = (r: { date: Date }) => (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10));
  const allDates = new Set<string>([
    ...verRows.map((r) => toStr(r)),
    ...apprSubRows.map((r) => toStr(r)),
    ...apprRevRows.map((r) => toStr(r)),
    ...incRows.map((r) => toStr(r)),
    ...susRows.map((r) => toStr(r)),
  ]);
  const sortedDates = Array.from(allDates).sort();

  const verificationTrend = verRows.map((r) => ({
    date: toStr(r),
    verified: Number(r.verified),
  }));

  const approvalsTrend = sortedDates.map((d) => ({
    date: d,
    submitted: submittedByDate.get(d) ?? 0,
    approved: reviewedByDate.get(d)?.approved ?? 0,
    rejected: reviewedByDate.get(d)?.rejected ?? 0,
  }));

  const riskTrend = sortedDates.map((d) => ({
    date: d,
    suspensions: suspensionsByDate.get(d) ?? 0,
    incidents: incidentsByDate.get(d) ?? 0,
  }));

  const result: OverviewTrendsResponse = {
    verificationTrend,
    approvalsTrend,
    riskTrend,
  };
  await setCache(key, result);
  return result;
}

export async function getTopProducers(
  dateFrom: string,
  dateTo: string,
  limit: number = 10
): Promise<OverviewTopProducersResponse> {
  const key = `${CACHE_PREFIX}:top-producers:${dateFrom}:${dateTo}:${limit}`;
  const cached = await getCached<OverviewTopProducersResponse>(key);
  if (cached) return cached;

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  type Row = { producerOrgId: number; producerOrgName: string; verified: bigint; printed: bigint };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      ap."producerOrgId" as "producerOrgId",
      po.name as "producerOrgName",
      COUNT(avl.id)::int as verified,
      COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL)::int as printed
    FROM auth_products ap
    INNER JOIN producer_orgs po ON po.id = ap."producerOrgId"
    INNER JOIN auth_batches ab ON ab."authProductId" = ap.id
    INNER JOIN auth_codes ac ON ac."batchId" = ab.id
    LEFT JOIN auth_verification_logs avl ON avl."codeId" = ac.id AND avl."createdAt" >= ${from} AND avl."createdAt" <= ${to}
    GROUP BY ap."producerOrgId", po.name
    ORDER BY verified DESC, printed DESC
    LIMIT ${limit}
  `;

  const data = rows.map((r) => ({
    producerOrgId: r.producerOrgId,
    producerOrgName: r.producerOrgName ?? `Org ${r.producerOrgId}`,
    verified: Number(r.verified),
    printed: Number(r.printed),
  }));

  const result = { data };
  await setCache(key, result);
  return result;
}

export async function getAlerts(): Promise<OverviewAlertsResponse> {
  const key = `${CACHE_PREFIX}:alerts`;
  const cached = await getCached<OverviewAlertsResponse>(key);
  if (cached) return cached;

  const [pendingApprovals, pendingKYC, openIncidents, lowRatioProducts, recentlyDeclined] =
    await Promise.all([
      prisma.producerApproval.findMany({
        where: { status: "SUBMITTED" },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { producerOrg: { select: { id: true, name: true } } },
      }),
      prisma.ownerKyc.findMany({
        where: {
          verificationStatus: "SUBMITTED",
          user: { producerOrgsOwned: { some: {} } },
        },
        take: 10,
        orderBy: { updatedAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              producerOrgsOwned: { take: 1, select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.complaintCase.findMany({
        where: { resolvedAt: null },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { producerOrg: { select: { id: true, name: true } } },
      }),
      getLowVerificationRatioProducts(),
      prisma.producerApproval.findMany({
        where: {
          reviewedAt: { not: null },
          status: { not: "SUBMITTED" },
        },
        take: 10,
        orderBy: { reviewedAt: "desc" },
        include: { producerOrg: { select: { id: true, name: true } } },
      }),
    ]);

  const result: OverviewAlertsResponse = {
    pendingApprovals: pendingApprovals.map((a) => ({
      id: a.id,
      entityType: a.entityType,
      entityId: a.entityId,
      producerOrgId: a.producerOrgId,
      producerOrgName: a.producerOrg?.name,
    })),
    pendingKYC: pendingKYC.map((k) => ({
      userId: k.userId,
      producerOrgId: k.user?.producerOrgsOwned?.[0]?.id,
      producerOrgName: k.user?.producerOrgsOwned?.[0]?.name,
    })),
    openIncidents: openIncidents.map((c) => ({
      id: c.id,
      caseNo: c.caseNo,
      producerOrgId: c.producerOrgId,
      producerOrgName: c.producerOrg?.name,
      severity: c.severity,
    })),
    lowVerificationRatioProducts: lowRatioProducts,
    recentlyDeclined: recentlyDeclined.map((a) => ({
      id: a.id,
      entityType: a.entityType,
      entityId: a.entityId,
      producerOrgId: a.producerOrgId,
      producerOrgName: a.producerOrg?.name,
      reviewedAt: a.reviewedAt?.toISOString() ?? "",
    })),
  };
  await setCache(key, result);
  return result;
}

async function getLowVerificationRatioProducts(): Promise<
  Array<{ productId: number; name: string; sku: string; printed: number; verified: number; producerOrgName?: string }>
> {
  type Row = {
    productId: number;
    name: string;
    sku: string;
    printed: bigint;
    verified: bigint;
    producerOrgName: string | null;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      ap.id as "productId",
      ap."productName" as name,
      ap.sku,
      COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL)::int as printed,
      COUNT(avl.id)::int as verified,
      po.name as "producerOrgName"
    FROM auth_products ap
    INNER JOIN producer_orgs po ON po.id = ap."producerOrgId"
    INNER JOIN auth_batches ab ON ab."authProductId" = ap.id
    INNER JOIN auth_codes ac ON ac."batchId" = ab.id
    LEFT JOIN auth_verification_logs avl ON avl."codeId" = ac.id
    GROUP BY ap.id, ap."productName", ap.sku, po.name
    HAVING COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL) > 50
      AND (COUNT(avl.id)::float / NULLIF(COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL), 0)) < 0.1
    ORDER BY verified ASC
    LIMIT 10
  `;
  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    printed: Number(r.printed),
    verified: Number(r.verified),
    producerOrgName: r.producerOrgName ?? undefined,
  }));
}
