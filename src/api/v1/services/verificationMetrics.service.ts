/**
 * V3.4+ Monitoring service
 * - Logs legacy update attempts when entities are locked for verification.
 * - Provides lightweight summary/timeseries/top entities for admin dashboards.
 *
 * IMPORTANT: Monitoring must never break business flows.
 */

function safeJson(data) {
  try {
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

function clampInt(v, { min, max, def }) {
  const n = parseInt(String(v ?? ''), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function buildSince(days) {
  const d = clampInt(days, { min: 1, max: 90, def: 7 });
  return { days: d, since: new Date(Date.now() - d * 24 * 60 * 60 * 1000) };
}

async function recordLockedUpdateAttempt({ prisma, req, entityType, entityId, reason }) {
  try {
    if (!prisma) return;
    if (!entityType || !entityId) return;

    const userId = req?.user?.id ? Number(req.user.id) : null;
    const endpoint = String(req?.originalUrl || req?.url || '').slice(0, 1024);
    const method = String(req?.method || '').slice(0, 32);
    const ip = req?.ip ? String(req.ip).slice(0, 64) : null;
    const userAgent = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 512) : null;
    const payloadJson = safeJson(req?.body);

    await prisma.verificationLockedUpdateAttempt.create({
      data: {
        userId,
        entityType,
        entityId,
        reason: reason ? String(reason).slice(0, 1000) : null,
        endpoint,
        method,
        ip,
        userAgent,
        payloadJson,
      },
    });
  } catch (_) {
    // swallow: monitoring must never break business flows
  }
}

async function summaryLockedUpdateAttempts({ prisma, days = 7, entityType = null, top = 10 }) {
  try {
    if (!prisma) return { ok: false, message: 'prisma missing' };
    const { days: d, since } = buildSince(days);
    const topN = clampInt(top, { min: 1, max: 50, def: 10 });

    const where = {
      createdAt: { gte: since },
      ...(entityType ? { entityType } : {}),
    };

    const total = await prisma.verificationLockedUpdateAttempt.count({ where });

    const byEntityType = await prisma.verificationLockedUpdateAttempt.groupBy({
      by: ['entityType'],
      where,
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
    });

    // distinct (entityType, entityId)
    const distinctRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "uniqueEntities"
      FROM (
        SELECT "entityType", "entityId"
        FROM "VerificationLockedUpdateAttempt"
        WHERE "createdAt" >= ${since}
        ${entityType ? prisma.$queryRaw`AND "entityType" = ${entityType}` : prisma.$queryRaw``}
        GROUP BY "entityType", "entityId"
      ) t;
    `;

    const uniqueEntities = Array.isArray(distinctRows) && distinctRows[0]?.uniqueEntities ? Number(distinctRows[0].uniqueEntities) : 0;

    const topEntities = await prisma.$queryRaw`
      SELECT "entityType" AS "entityType", "entityId" AS "entityId", COUNT(*)::int AS "count"
      FROM "VerificationLockedUpdateAttempt"
      WHERE "createdAt" >= ${since}
      ${entityType ? prisma.$queryRaw`AND "entityType" = ${entityType}` : prisma.$queryRaw``}
      GROUP BY "entityType", "entityId"
      ORDER BY COUNT(*) DESC
      LIMIT ${topN};
    `;

    return {
      ok: true,
      days: d,
      since,
      total,
      uniqueEntities,
      byEntityType: (byEntityType || []).map((r) => ({ entityType: r.entityType, count: r._count?._all || 0 })),
      topEntities: Array.isArray(topEntities) ? topEntities : [],
    };
  } catch (e) {
    return { ok: false, message: e?.message || 'summary failed' };
  }
}

async function timeseriesLockedUpdateAttempts({ prisma, days = 7, entityType = null }) {
  try {
    if (!prisma) return { ok: false, message: 'prisma missing' };
    const { days: d, since } = buildSince(days);

    // day bucket (UTC) - good enough for ops dashboard
    const rows = await prisma.$queryRaw`
      SELECT DATE("createdAt") AS "day", COUNT(*)::int AS "count"
      FROM "VerificationLockedUpdateAttempt"
      WHERE "createdAt" >= ${since}
      ${entityType ? prisma.$queryRaw`AND "entityType" = ${entityType}` : prisma.$queryRaw``}
      GROUP BY DATE("createdAt")
      ORDER BY DATE("createdAt") ASC;
    `;

    return {
      ok: true,
      days: d,
      since,
      series: Array.isArray(rows)
        ? rows.map((r) => ({ day: r.day, count: Number(r.count || 0) }))
        : [],
    };
  } catch (e) {
    return { ok: false, message: e?.message || 'timeseries failed' };
  }
}

async function topEntitiesLockedUpdateAttempts({ prisma, days = 7, entityType = null, limit = 10 }) {
  try {
    if (!prisma) return { ok: false, message: 'prisma missing' };
    const { days: d, since } = buildSince(days);
    const lim = clampInt(limit, { min: 1, max: 100, def: 10 });

    const rows = await prisma.$queryRaw`
      SELECT "entityType" AS "entityType", "entityId" AS "entityId", COUNT(*)::int AS "count"
      FROM "VerificationLockedUpdateAttempt"
      WHERE "createdAt" >= ${since}
      ${entityType ? prisma.$queryRaw`AND "entityType" = ${entityType}` : prisma.$queryRaw``}
      GROUP BY "entityType", "entityId"
      ORDER BY COUNT(*) DESC
      LIMIT ${lim};
    `;

    return {
      ok: true,
      days: d,
      since,
      limit: lim,
      rows: Array.isArray(rows) ? rows : [],
    };
  } catch (e) {
    return { ok: false, message: e?.message || 'top entities failed' };
  }
}

module.exports = {
  recordLockedUpdateAttempt,
  summaryLockedUpdateAttempts,
  timeseriesLockedUpdateAttempts,
  topEntitiesLockedUpdateAttempts,
};

export {};
