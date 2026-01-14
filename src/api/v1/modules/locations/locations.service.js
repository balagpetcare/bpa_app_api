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

module.exports = { getDhakaLocations };
