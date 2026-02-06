/**
 * Phase 4: Ads module – serve by country, admin CRUD.
 * Reference: docs/GLOBAL_READY_FULL_PLANNING.md
 */

import prisma from "../../../../infrastructure/db/prismaClient";

function parseNum(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/**
 * Public: list active ads for a country. Returns [] if ADS feature disabled or no ads.
 */
async function serve(countryCode: string, policy: any) {
  const code = String(countryCode || "").toUpperCase().trim() || "BD";
  if (policy?.features) {
    const adsFeature = policy.features.find((f: any) => f.featureCode === "ADS" && f.enabled);
    if (!adsFeature) return [];
  }

  const country = await prisma.country.findFirst({
    where: { code, isActive: true },
    select: { id: true },
  });
  if (!country) return [];

  const now = new Date();
  const list = await prisma.ad.findMany({
    where: {
      countryId: country.id,
      status: "ACTIVE",
      OR: [
        { startAt: null, endAt: null },
        { startAt: { lte: now }, endAt: null },
        { startAt: null, endAt: { gte: now } },
        { startAt: { lte: now }, endAt: { gte: now } },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: 50,
    include: {
      media: { select: { id: true, url: true, type: true, altText: true } },
    },
  });

  return list.map((a: any) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    linkUrl: a.linkUrl,
    media: a.media,
    sortOrder: a.sortOrder,
  }));
}

/**
 * Admin: list ads (paginated, filter by countryId, status).
 */
async function adminList(filters: { countryId?: number; status?: string; limit?: number; cursor?: number }) {
  const limit = Math.min(parseNum(filters?.limit, 20), 100);
  const where: any = {};
  if (filters?.countryId) where.countryId = filters.countryId;
  if (filters?.status) where.status = String(filters.status).toUpperCase();

  const list = await prisma.ad.findMany({
    where,
    take: limit + 1,
    orderBy: { id: "desc" },
    cursor: filters?.cursor ? { id: filters.cursor } : undefined,
    skip: filters?.cursor ? 1 : 0,
    include: {
      country: { select: { id: true, code: true, name: true } },
      media: { select: { id: true, url: true, type: true } },
    },
  });

  const hasMore = list.length > limit;
  const data = hasMore ? list.slice(0, limit) : list;
  const nextCursor = hasMore ? data[data.length - 1].id : null;
  return { data, nextCursor };
}

/**
 * Admin: create ad.
 */
async function adminCreate(body: {
  countryId: number;
  title: string;
  body?: string;
  mediaId?: number;
  linkUrl?: string;
  status?: string;
  startAt?: string;
  endAt?: string;
  targetCountryCodes?: string;
  sortOrder?: number;
}) {
  const countryId = parseNum(body.countryId);
  if (!countryId) throw Object.assign(new Error("countryId required"), { statusCode: 400 });

  const title = String(body.title || "").trim();
  if (!title) throw Object.assign(new Error("title required"), { statusCode: 400 });

  const status = ["DRAFT", "ACTIVE", "PAUSED"].includes(String(body.status || "").toUpperCase())
    ? String(body.status).toUpperCase()
    : "DRAFT";

  const ad = await prisma.ad.create({
    data: {
      countryId,
      title,
      body: body.body?.trim() || null,
      mediaId: body.mediaId ? parseNum(body.mediaId) : null,
      linkUrl: body.linkUrl?.trim() || null,
      status,
      startAt: body.startAt ? new Date(body.startAt) : null,
      endAt: body.endAt ? new Date(body.endAt) : null,
      targetCountryCodes: body.targetCountryCodes?.trim() || null,
      sortOrder: parseNum(body.sortOrder, 0),
    },
    include: {
      country: { select: { id: true, code: true, name: true } },
      media: { select: { id: true, url: true } },
    },
  });
  return ad;
}

/**
 * Admin: update ad.
 */
async function adminUpdate(
  id: number,
  body: {
    title?: string;
    body?: string;
    mediaId?: number;
    linkUrl?: string;
    status?: string;
    startAt?: string;
    endAt?: string;
    targetCountryCodes?: string;
    sortOrder?: number;
  }
) {
  const existing = await prisma.ad.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Ad not found"), { statusCode: 404 });

  const data: any = {};
  if (body.title !== undefined) data.title = String(body.title).trim() || existing.title;
  if (body.body !== undefined) data.body = body.body?.trim() || null;
  if (body.mediaId !== undefined) data.mediaId = body.mediaId ? parseNum(body.mediaId) : null;
  if (body.linkUrl !== undefined) data.linkUrl = body.linkUrl?.trim() || null;
  if (body.status !== undefined && ["DRAFT", "ACTIVE", "PAUSED"].includes(String(body.status).toUpperCase())) {
    data.status = String(body.status).toUpperCase();
  }
  if (body.startAt !== undefined) data.startAt = body.startAt ? new Date(body.startAt) : null;
  if (body.endAt !== undefined) data.endAt = body.endAt ? new Date(body.endAt) : null;
  if (body.targetCountryCodes !== undefined) data.targetCountryCodes = body.targetCountryCodes?.trim() || null;
  if (body.sortOrder !== undefined) data.sortOrder = parseNum(body.sortOrder, existing.sortOrder);

  const ad = await prisma.ad.update({
    where: { id },
    data,
    include: {
      country: { select: { id: true, code: true, name: true } },
      media: { select: { id: true, url: true } },
    },
  });
  return ad;
}

/**
 * Admin: delete ad.
 */
async function adminDelete(id: number) {
  const existing = await prisma.ad.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Ad not found"), { statusCode: 404 });
  await prisma.ad.delete({ where: { id } });
  return { id, deleted: true };
}

module.exports = {
  serve,
  adminList,
  adminCreate,
  adminUpdate,
  adminDelete,
};
