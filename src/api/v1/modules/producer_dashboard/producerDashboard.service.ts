const prisma = require("../../../../infrastructure/db/prismaClient");
const redis = require("../../../../utils/redis");

const CACHE_TTL = 300; // seconds
const CACHE_PREFIX = "pdash";
const LOW_VERIFICATION_THRESHOLD = 50;
const LOW_VERIFICATION_RATIO = 0.1;

import type {
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  DashboardTopProductsResponse,
  DashboardAlertsResponse,
  DashboardAlertItem,
} from "./producerDashboard.types";

function cacheKey(orgId: number, endpoint: string, dateFrom: string, dateTo: string): string {
  return `${CACHE_PREFIX}:${orgId}:${endpoint}:${dateFrom}:${dateTo}`;
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

export async function getSummary(
  producerOrgId: number,
  _dateFrom: string,
  _dateTo: string
): Promise<DashboardSummaryResponse> {
  const key = cacheKey(producerOrgId, "summary", _dateFrom, _dateTo);
  const cached = await getCached<DashboardSummaryResponse>(key);
  if (cached) return cached;

  const orgId = Number(producerOrgId);
  const whereOrg = { producerOrgId: orgId };
  const batchWhere = { authProduct: { producerOrgId: orgId } };

  const [
    totalProducts,
    activeProducts,
    brandsGroup,
    totalBatches,
    printedAgg,
    verifiedCount,
    pendingApprovals,
  ] = await Promise.all([
    prisma.authProduct.count({ where: whereOrg }),
    prisma.authProduct.count({ where: { ...whereOrg, status: "ACTIVE" } }),
    prisma.authProduct.groupBy({ by: ["brandName"], where: whereOrg }),
    prisma.authBatch.count({ where: batchWhere }),
    prisma.batchSerialState.aggregate({
      _sum: { allocatedCount: true },
      where: { batch: { authProduct: { producerOrgId: orgId } } },
    }),
    prisma.authVerificationLog.count({
      where: {
        codeId: { not: null },
        code: { batch: { authProduct: { producerOrgId: orgId } } },
      },
    }),
    prisma.producerApproval.count({ where: { producerOrgId: orgId, status: "SUBMITTED" } }),
  ]);

  const totalBrands = brandsGroup.length;
  const printedCodes = printedAgg._sum?.allocatedCount ?? 0;

  const result: DashboardSummaryResponse = {
    totalProducts,
    activeProducts,
    totalBrands,
    totalBatches,
    printedCodes,
    verifiedCodes: verifiedCount,
    pendingApprovals,
    lastUpdatedAt: new Date().toISOString(),
  };
  await setCache(key, result);
  return result;
}

export async function getTrends(
  producerOrgId: number,
  dateFrom: string,
  dateTo: string
): Promise<DashboardTrendsResponse> {
  const key = cacheKey(producerOrgId, "trends", dateFrom, dateTo);
  const cached = await getCached<DashboardTrendsResponse>(key);
  if (cached) return cached;

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  type Row = { date: Date; verified: bigint };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT DATE(avl."createdAt") as date, COUNT(*)::int as verified
    FROM auth_verification_logs avl
    INNER JOIN auth_codes ac ON ac.id = avl."codeId"
    INNER JOIN auth_batches ab ON ab.id = ac."batchId"
    INNER JOIN auth_products ap ON ap.id = ab."authProductId"
    WHERE ap."producerOrgId" = ${producerOrgId}
      AND avl."createdAt" >= ${from}
      AND avl."createdAt" <= ${to}
    GROUP BY DATE(avl."createdAt")
    ORDER BY date
  `;

  const data = rows.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    verified: Number(r.verified),
  }));

  const result = { data };
  await setCache(key, result);
  return result;
}

export async function getTopProducts(
  producerOrgId: number,
  dateFrom: string,
  dateTo: string,
  limit: number = 10
): Promise<DashboardTopProductsResponse> {
  const key = cacheKey(producerOrgId, "top-products", dateFrom, dateTo);
  const cached = await getCached<DashboardTopProductsResponse>(key);
  if (cached) return cached;

  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  type Row = {
    productId: number;
    name: string;
    sku: string;
    printed: bigint;
    verified: bigint;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      ap.id as "productId",
      ap."productName" as name,
      ap.sku,
      COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL)::int as printed,
      COUNT(avl.id)::int as verified
    FROM auth_products ap
    INNER JOIN auth_batches ab ON ab."authProductId" = ap.id
    INNER JOIN auth_codes ac ON ac."batchId" = ab.id
    LEFT JOIN auth_verification_logs avl ON avl."codeId" = ac.id AND avl."createdAt" >= ${from} AND avl."createdAt" <= ${to}
    WHERE ap."producerOrgId" = ${producerOrgId}
    GROUP BY ap.id, ap."productName", ap.sku
    ORDER BY verified DESC, printed DESC
    LIMIT ${limit}
  `;

  const data = rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    printed: Number(r.printed),
    verified: Number(r.verified),
  }));

  const result = { data };
  await setCache(key, result);
  return result;
}

export async function getAlerts(producerOrgId: number): Promise<DashboardAlertsResponse> {
  const key = `${CACHE_PREFIX}:${producerOrgId}:alerts`;
  const cached = await getCached<DashboardAlertsResponse>(key);
  if (cached) return cached;

  const orgId = Number(producerOrgId);
  const items: DashboardAlertItem[] = [];

  const [pendingApprovals, suspendedProducts, lowRatioProducts] = await Promise.all([
    prisma.producerApproval.findMany({
      where: { producerOrgId: orgId, status: "SUBMITTED" },
      take: 10,
      orderBy: { createdAt: "desc" },
    }),
    prisma.authProduct.findMany({
      where: { producerOrgId: orgId, status: { in: ["INACTIVE", "REJECTED"] } },
      select: { id: true, productName: true, sku: true },
      take: 10,
    }),
    getLowVerificationRatioProducts(orgId),
  ]);

  for (const a of pendingApprovals) {
    items.push({
      type: "pending_approval",
      severity: "warning",
      title: "Pending approval",
      message: `${a.entityType} #${a.entityId} is awaiting review`,
      actionUrl: "/producer/approvals",
    });
  }
  for (const p of suspendedProducts) {
    items.push({
      type: "suspended_product",
      severity: "danger",
      title: "Product not active",
      message: `${p.productName} (${p.sku}) is inactive or rejected`,
      actionUrl: `/producer/products/${p.id}`,
    });
  }
  for (const p of lowRatioProducts) {
    items.push({
      type: "low_verification_ratio",
      severity: "info",
      title: "Low verification ratio",
      message: `${p.name} (${p.sku}): ${p.verified} verified of ${p.printed} printed`,
      actionUrl: `/producer/products/${p.productId}`,
    });
  }

  const result = { items };
  await setCache(key, result);
  return result;
}

async function getLowVerificationRatioProducts(
  producerOrgId: number
): Promise<Array<{ productId: number; name: string; sku: string; printed: number; verified: number }>> {
  type Row = { productId: number; name: string; sku: string; printed: bigint; verified: bigint };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      ap.id as "productId",
      ap."productName" as name,
      ap.sku,
      COUNT(ac.id) FILTER (WHERE ac."printedAt" IS NOT NULL)::int as printed,
      COUNT(avl.id)::int as verified
    FROM auth_products ap
    INNER JOIN auth_batches ab ON ab."authProductId" = ap.id
    INNER JOIN auth_codes ac ON ac."batchId" = ab.id
    LEFT JOIN auth_verification_logs avl ON avl."codeId" = ac.id
    WHERE ap."producerOrgId" = ${producerOrgId}
    GROUP BY ap.id, ap."productName", ap.sku
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
  }));
}
