const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// simple in-memory cache
let cache = { ts: 0, key: '', value: null };
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function pickName(area, lang) {
  if (lang === 'bn') return area.nameBn || area.nameEn;
  return area.nameEn;
}

async function getDhakaLocations({ lang = 'en' } = {}) {
  const key = `dhaka:${lang}`;
  const now = Date.now();
  if (cache.value && cache.key === key && (now - cache.ts) < TTL_MS) {
    return cache.value;
  }

  // Dhaka District code in this project seed: DIS-47
  const dhakaDistrict = await prisma.bdDistrict.findUnique({
    where: { code: 'DIS-47' },
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });

  if (!dhakaDistrict) {
    return { district: null, corporations: [] };
  }

  // Pull only Dhaka city hierarchy nodes by code-prefix (fast + reliable)
  const areas = await prisma.bdArea.findMany({
    where: {
      OR: [
        { code: { startsWith: 'CC-' } },
        { code: { startsWith: 'ZONE-' } },
        { code: { startsWith: 'WARD-' } },
      ],
    },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameBn: true,
      type: true,
      parentId: true,
      districtId: true,
    },
    orderBy: [{ type: 'asc' }, { id: 'asc' }],
  });

  const byId = new Map();
  for (const a of areas) byId.set(a.id, a);

  // group children by parentId
  const children = new Map();
  for (const a of areas) {
    if (!a.parentId) continue;
    if (!children.has(a.parentId)) children.set(a.parentId, []);
    children.get(a.parentId).push(a);
  }

  const corporations = areas
    .filter(a => a.type === 'CITY_CORPORATION')
    .map(corp => {
      const zones = (children.get(corp.id) || [])
        .filter(z => z.type === 'ZONE')
        .map(zone => {
          const wards = (children.get(zone.id) || [])
            .filter(w => w.type === 'WARD')
            .map(w => ({
              id: w.id,
              code: w.code,
              name: pickName(w, lang),
            }));
          return {
            id: zone.id,
            code: zone.code,
            name: pickName(zone, lang),
            wards,
          };
        });

      return {
        id: corp.id,
        code: corp.code,
        name: pickName(corp, lang),
        zones,
      };
    });

  const payload = {
    district: {
      id: dhakaDistrict.id,
      code: dhakaDistrict.code,
      name: (lang === 'bn') ? (dhakaDistrict.nameBn || dhakaDistrict.nameEn) : dhakaDistrict.nameEn,
    },
    corporations,
    meta: {
      corpCount: corporations.length,
      zoneCount: corporations.reduce((s, c) => s + c.zones.length, 0),
      wardCount: corporations.reduce((s, c) => s + c.zones.reduce((ss, z) => ss + z.wards.length, 0), 0),
    },
  };

  cache = { ts: now, key, value: payload };
  return payload;
}

function pickText(item, lang) {
  if (!item) return null;
  return lang === 'bn' ? (item.nameBn || item.nameEn) : item.nameEn;
}

async function listDivisions({ lang = 'en' } = {}) {
  const rows = await prisma.bdDivision.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, code: true, nameEn: true, nameBn: true },
  });
  return rows.map(r => ({ id: r.id, code: r.code, name: pickText(r, lang) }));
}

interface ListDistrictsParams { divisionId?: number; divisionCode?: string; lang?: string }
async function listDistricts({ divisionId, divisionCode, lang = 'en' }: ListDistrictsParams = {}) {
  let divId = divisionId ? Number(divisionId) : null;
  if (!divId && divisionCode) {
    const div = await prisma.bdDivision.findUnique({ where: { code: String(divisionCode) }, select: { id: true } });
    divId = div?.id || null;
  }
  if (!divId) return [];
  const rows = await prisma.bdDistrict.findMany({
    where: { divisionId: divId },
    orderBy: { id: 'asc' },
    select: { id: true, code: true, nameEn: true, nameBn: true, divisionId: true },
  });
  return rows.map(r => ({ id: r.id, code: r.code, name: pickText(r, lang), divisionId: r.divisionId }));
}

interface ListUpazilasParams { districtId?: number; districtCode?: string; lang?: string }
async function listUpazilas({ districtId, districtCode, lang = 'en' }: ListUpazilasParams = {}) {
  let distId = districtId ? Number(districtId) : null;
  if (!distId && districtCode) {
    const dist = await prisma.bdDistrict.findUnique({ where: { code: String(districtCode) }, select: { id: true } });
    distId = dist?.id || null;
  }
  if (!distId) return [];
  const rows = await prisma.bdUpazila.findMany({
    where: { districtId: distId },
    orderBy: { id: 'asc' },
    select: { id: true, code: true, nameEn: true, nameBn: true, districtId: true },
  });
  return rows.map(r => ({ id: r.id, code: r.code, name: pickText(r, lang), districtId: r.districtId }));
}

interface ListAreasParams { upazilaId?: number; districtId?: number; parentId?: number; lang?: string }
async function listAreas({ upazilaId, districtId, parentId, lang = 'en' }: ListAreasParams = {}) {
  const where: any = {};
  if (upazilaId !== undefined && upazilaId !== null && String(upazilaId) !== '') where.upazilaId = Number(upazilaId);
  if (districtId !== undefined && districtId !== null && String(districtId) !== '') where.districtId = Number(districtId);
  if (parentId !== undefined && parentId !== null && String(parentId) !== '') where.parentId = Number(parentId);
  const rows = await prisma.bdArea.findMany({
    where,
    orderBy: [{ type: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, nameEn: true, nameBn: true, type: true, parentId: true, upazilaId: true, districtId: true },
  });
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: pickText(r, lang),
    type: r.type,
    parentId: r.parentId,
    upazilaId: r.upazilaId,
    districtId: r.districtId,
  }));
}

interface SearchAreasParams { q?: string; districtId?: number; upazilaId?: number; lang?: string; limit?: number }
async function searchAreas({ q, districtId, upazilaId, lang = 'en', limit = 50 }: SearchAreasParams = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  const where: any = {
    OR: [
      { nameEn: { contains: query, mode: 'insensitive' } },
      { nameBn: { contains: query, mode: 'insensitive' } },
      { code: { contains: query, mode: 'insensitive' } },
    ],
  };
  if (districtId) where.districtId = Number(districtId);
  if (upazilaId) where.upazilaId = Number(upazilaId);

  const rows = await prisma.bdArea.findMany({
    where,
    take: Math.min(200, Number(limit) || 50),
    orderBy: [{ type: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, nameEn: true, nameBn: true, type: true, parentId: true, upazilaId: true, districtId: true },
  });
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    name: pickText(r, lang),
    type: r.type,
    parentId: r.parentId,
    upazilaId: r.upazilaId,
    districtId: r.districtId,
  }));
}

module.exports = {
  getDhakaLocations,
  listDivisions,
  listDistricts,
  listUpazilas,
  listAreas,
  searchAreas,
};

export {};
