/*
  Requires prisma injected via req.prisma (recommended) OR require your prisma singleton.
  If you already have prisma instance on req: use req.prisma.
*/

const axios = require('axios');
const { matchCoordinatesToLocation } = require('./locationMatcher.service');
const locationService = require('../../../../modules/location/location.service');

// Phase 3: Redis cache when available, else in-memory (TTL: 1 hour in-memory, 24h Redis)
const CACHE_TTL_MS = 60 * 60 * 1000;
const REDIS_TTL_SEC = 24 * 60 * 60; // 24h
let redis;
try {
  redis = require('../../../../utils/redis');
} catch (_) {
  redis = null;
}
const geocodeCache = new Map();

function getCacheKey(type, key) {
  return `geocode:${type}:${key}`;
}

async function getCached(key) {
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw);
    } catch (_) {
      // fall through to in-memory
    }
  }
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.data;
}

async function setCache(key, data) {
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(data), 'EX', REDIS_TTL_SEC);
      return;
    } catch (_) {
      // fall through to in-memory
    }
  }
  geocodeCache.set(key, { data, timestamp: Date.now() });
}

function getPrisma(req) {
  if (!req.prisma) throw new Error('Prisma instance not found on req.prisma');
  return req.prisma;
}

function asInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function safeStr(v) {
  return v === null || v === undefined ? '' : String(v);
}

async function buildDhakaAreaPath(prisma, areaId, maxDepth = 8) {
  // returns { names: [leaf..root], leaf }
  const names = [];
  let curId = asInt(areaId);
  let leaf = null;
  for (let i = 0; i < maxDepth && curId; i++) {
    // eslint-disable-next-line no-await-in-loop
    const row = await prisma.area.findUnique({
      where: { id: curId },
      select: { id: true, nameEn: true, nameBn: true, parentId: true, cityCorporationId: true }
    });
    if (!row) break;
    if (!leaf) leaf = row;
    names.push(row.nameEn || row.nameBn || `Area#${row.id}`);
    curId = row.parentId;
  }
  return { names, leaf };
}

async function buildBdAreaFullPath(prisma, bdAreaRow) {
  // bd_areas can be linked via upazilaId (standard) or districtId/parent tree (Dhaka legacy/new)
  const parts = [];

  // If upazila present, load district + division
  if (bdAreaRow?.upazilaId) {
    const upazila = await prisma.bdUpazila.findUnique({
      where: { id: bdAreaRow.upazilaId },
      select: {
        id: true,
        nameEn: true,
        nameBn: true,
        district: {
          select: {
            id: true,
            nameEn: true,
            nameBn: true,
            division: { select: { id: true, nameEn: true, nameBn: true } }
          }
        }
      }
    });
    if (upazila?.district?.division) parts.push(upazila.district.division.nameEn || upazila.district.division.nameBn);
    if (upazila?.district) parts.push(upazila.district.nameEn || upazila.district.nameBn);
    if (upazila) parts.push(upazila.nameEn || upazila.nameBn);
  } else if (bdAreaRow?.districtId) {
    const district = await prisma.bdDistrict.findUnique({
      where: { id: bdAreaRow.districtId },
      select: { id: true, nameEn: true, nameBn: true, division: { select: { id: true, nameEn: true, nameBn: true } } }
    });
    if (district?.division) parts.push(district.division.nameEn || district.division.nameBn);
    if (district) parts.push(district.nameEn || district.nameBn);
  }

  // parent chain inside bd_areas
  const chain = [];
  let cur = bdAreaRow;
  let depth = 0;
  while (cur && depth < 8) {
    chain.push(cur.nameEn || cur.nameBn || `Area#${cur.id}`);
    if (!cur.parentId) break;
    // eslint-disable-next-line no-await-in-loop
    cur = await prisma.bdArea.findUnique({
      where: { id: cur.parentId },
      select: { id: true, nameEn: true, nameBn: true, parentId: true, upazilaId: true, districtId: true, type: true }
    });
    depth += 1;
  }
  parts.push(...chain.reverse());
  return parts.filter(Boolean).join(' > ');
}

exports.listCityCorporations = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const rows = await prisma.cityCorporation.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameBn: true }
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listCountries = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const activeRaw = String(req.query.active ?? '1').trim().toLowerCase();
    const isActive =
      activeRaw === '1' || activeRaw === 'true' ? true : activeRaw === '0' || activeRaw === 'false' ? false : true;

    const rows = await prisma.country.findMany({
      where: { isActive },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true }
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.searchAreas = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const corp = String(req.query.corp || '').toUpperCase();
    const q = String(req.query.q || '').trim();
    const rawParentId = req.query.parentId;
    let parentId = null;
    if (rawParentId !== undefined) {
      const s = String(rawParentId).trim();
      if (s === "" || s.toLowerCase() === "null") {
        parentId = null;
      } else {
        const n = parseInt(s, 10);
        if (Number.isNaN(n)) {
          return res.status(400).json({ success: false, message: "parentId must be an integer or null" });
        }
        parentId = n;
      }
    }
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);

    if (!corp) return res.status(400).json({ success: false, message: 'corp is required (DNCC/DSCC)' });

    const corpRow = await prisma.cityCorporation.findUnique({ where: { code: corp } });
    if (!corpRow) return res.status(404).json({ success: false, message: 'City corporation not found' });

    const where = {
      cityCorporationId: corpRow.id,
      parentId: parentId || null,
      ...(q
        ? {
            OR: [
              { nameEn: { contains: q, mode: 'insensitive' } },
              { nameBn: { contains: q, mode: 'insensitive' } },
              { searchKeywords: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const rows = await prisma.area.findMany({
      where,
      take: limit,
      orderBy: [{ nameEn: 'asc' }],
      select: { id: true, nameEn: true, nameBn: true, parentId: true }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ------------------------------
// National BD hierarchy
// ------------------------------

exports.listDivisions = async (req, res) => {
  try {
    const result = await locationService.listDivisions(getPrisma(req), {
      q: req.query?.q,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listDistricts = async (req, res) => {
  try {
    const result = await locationService.listDistricts(getPrisma(req), {
      divisionId: req.query?.divisionId,
      q: req.query?.q,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listUpazilas = async (req, res) => {
  try {
    const result = await locationService.listUpazilas(getPrisma(req), {
      districtId: req.query?.districtId,
      q: req.query?.q,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listUnions = async (req, res) => {
  try {
    const result = await locationService.listUnions(getPrisma(req), {
      upazilaId: req.query?.upazilaId,
      q: req.query?.q,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listBdAreas = async (req, res) => {
  try {
    const result = await locationService.listAreas(getPrisma(req), {
      upazilaId: req.query?.upazilaId,
      unionId: req.query?.unionId,
      q: req.query?.q,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ------------------------------
// Unified search (BD + Dhaka)
// ------------------------------

exports.searchLocations = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const q = safeStr(req.query.q).trim();
    if (!q) return res.json({ success: true, data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

    const central = await locationService.searchLocations(prisma, {
      q,
      level: req.query?.level || "ALL",
      divisionId: req.query?.divisionId,
      districtId: req.query?.districtId,
      upazilaId: req.query?.upazilaId,
      unionId: req.query?.unionId,
      page: req.query?.page,
      pageSize: req.query?.pageSize || req.query?.limit,
      locale: req.query?.locale,
    });

    const bdData = (central.data || []).map((row) => ({
      kind: row.level === "AREA" ? "BD_AREA" : row.level,
      level: row.level,
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameBn: row.nameBn,
      label: row.label,
      divisionId: row.divisionId || null,
      districtId: row.districtId || null,
      upazilaId: row.upazilaId || null,
      unionId: row.unionId || null,
      type: row.type || null,
      fullPathText: row.label || row.nameEn || row.nameBn || null,
    }));

    // Backward compatibility: keep Dhaka tree search results unless caller disables it.
    const includeDhaka = String(req.query?.includeDhaka ?? "1").toLowerCase();
    let dhakaItems = [];
    if (includeDhaka !== "0" && includeDhaka !== "false") {
      const limit = Math.min(parseInt(req.query.limit || req.query.pageSize || '20', 10) || 20, 50);
      const dhakaRows = await prisma.area.findMany({
        where: {
          OR: [
            { nameEn: { contains: q, mode: 'insensitive' } },
            { nameBn: { contains: q, mode: 'insensitive' } },
            { searchKeywords: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { nameEn: 'asc' },
        select: {
          id: true,
          nameEn: true,
          nameBn: true,
          cityCorporationId: true,
        },
      });
      for (const row of dhakaRows) {
        // eslint-disable-next-line no-await-in-loop
        const corp = await prisma.cityCorporation.findUnique({
          where: { id: row.cityCorporationId },
          select: { code: true, nameEn: true, nameBn: true },
        });
        // eslint-disable-next-line no-await-in-loop
        const { names } = await buildDhakaAreaPath(prisma, row.id);
        const corpName = corp?.nameEn || corp?.nameBn || corp?.code;
        dhakaItems.push({
          kind: 'DHAKA_AREA',
          level: 'AREA',
          id: row.id,
          dhakaAreaId: row.id,
          cityCorporationId: row.cityCorporationId,
          cityCorporationCode: corp?.code || null,
          nameEn: row.nameEn,
          nameBn: row.nameBn,
          label: row.nameEn || row.nameBn,
          fullPathText: [corpName, ...names.reverse()].filter(Boolean).join(' > '),
        });
      }
    }

    const data = [...bdData, ...dhakaItems];
    res.json({ success: true, data, meta: central.meta });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.validateSelection = async (req, res) => {
  try {
    const validated = await locationService.validateSelection(getPrisma(req), req.body || {});
    if (!validated.ok) return res.status(400).json({ success: false, ...validated });
    return res.json({ success: true, data: validated });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.listCoverage = async (req, res) => {
  try {
    const entityType = String(req.params.entityType || "").toUpperCase();
    const entityId = Number(req.params.entityId);
    if (!entityType || !Number.isFinite(entityId)) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required" });
    }
    const data = await locationService.listCoverage(getPrisma(req), entityType, entityId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.replaceCoverage = async (req, res) => {
  try {
    const entityType = String(req.params.entityType || "").toUpperCase();
    const entityId = Number(req.params.entityId);
    if (!entityType || !Number.isFinite(entityId)) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required" });
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const replaced = await locationService.replaceCoverage(getPrisma(req), entityType, entityId, rows);
    if (!replaced.ok) return res.status(400).json({ success: false, ...replaced });
    const data = await locationService.listCoverage(getPrisma(req), entityType, entityId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.resolveLocation = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const bdAreaId = asInt(req.query.bdAreaId);
    const dhakaAreaId = asInt(req.query.dhakaAreaId);
    if (!bdAreaId && !dhakaAreaId) {
      return res.status(400).json({ success: false, message: 'bdAreaId or dhakaAreaId is required' });
    }

    if (bdAreaId) {
      const r = await prisma.bdArea.findUnique({
        where: { id: bdAreaId },
        select: { id: true, nameEn: true, nameBn: true, type: true, upazilaId: true, districtId: true, parentId: true, latitude: true, longitude: true }
      });
      if (!r) return res.status(404).json({ success: false, message: 'BdArea not found' });
      const fullPathText = await buildBdAreaFullPath(prisma, r);
      return res.json({
        success: true,
        data: {
          kind: 'BD_AREA',
          bdAreaId: r.id,
          nameEn: r.nameEn,
          nameBn: r.nameBn,
          type: r.type,
          fullPathText,
          latitude: r.latitude ? Number(r.latitude) : null,
          longitude: r.longitude ? Number(r.longitude) : null
        }
      });
    }

    const r = await prisma.area.findUnique({
      where: { id: dhakaAreaId },
      select: { id: true, nameEn: true, nameBn: true, parentId: true, cityCorporationId: true, latitude: true, longitude: true }
    });
    if (!r) return res.status(404).json({ success: false, message: 'Area not found' });
    const corp = await prisma.cityCorporation.findUnique({ where: { id: r.cityCorporationId }, select: { code: true, nameEn: true, nameBn: true } });
    const { names } = await buildDhakaAreaPath(prisma, r.id);
    const corpName = corp?.nameEn || corp?.nameBn || corp?.code;
    const fullPathText = [corpName, ...names.reverse()].filter(Boolean).join(' > ');

    return res.json({
      success: true,
      data: {
        kind: 'DHAKA_AREA',
        dhakaAreaId: r.id,
        cityCorporationId: r.cityCorporationId,
        cityCorporationCode: corp?.code || null,
        nameEn: r.nameEn,
        nameBn: r.nameBn,
        fullPathText,
        latitude: r.latitude ? Number(r.latitude) : null,
        longitude: r.longitude ? Number(r.longitude) : null
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

// ------------------------------
// Geocoding endpoints (Nominatim/OpenStreetMap)
// ------------------------------

exports.geocode = async (req, res) => {
  try {
    const { query, latitude, longitude } = req.body || {};

    // Forward geocoding: search by query
    if (query) {
      const rawCodes =
        (req.body?.countryCodes ?? req.body?.countryCode ?? req.query?.countryCodes ?? req.query?.countryCode ?? '')
          .toString()
          .trim();
      const global = String(req.body?.global ?? req.query?.global ?? '').toLowerCase();
      const normalizedCodes = rawCodes
        ? rawCodes
            .split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .map((x) => (x.length > 2 ? x.slice(0, 2) : x))
            .filter((x) => /^[a-z]{2}$/.test(x))
            .join(',')
        : '';
      const shouldOmitCountryFilter = global === '1' || global === 'true';
      const fallbackCountryCodes = 'bd';
      const countrycodes = shouldOmitCountryFilter ? '' : normalizedCodes || fallbackCountryCodes;

      const cacheKey = getCacheKey(
        'forward',
        `${countrycodes || 'all'}:${query.toLowerCase().trim()}`
      );
      const cached = await getCached(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: query,
          format: 'json',
          limit: 10,
          addressdetails: 1,
          ...(countrycodes ? { countrycodes } : {}),
        },
        headers: {
          'User-Agent': 'BPA-Location-System/1.0', // Required by Nominatim
        },
        timeout: 10000,
      });

      const results = (response.data || []).map((item) => ({
        place_id: item.place_id ?? null,
        osm_id: item.osm_id ?? null,
        osm_type: item.osm_type ?? null,
        display_name: item.display_name,
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        type: item.type,
        class: item.class,
        address: item.address || {},
      }));

      await setCache(cacheKey, results);
      return res.json({ success: true, data: results });
    }

    // Reverse geocoding: search by coordinates
    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ success: false, message: 'Invalid latitude or longitude' });
      }

      const cacheKey = getCacheKey('reverse', `${lat.toFixed(4)},${lng.toFixed(4)}`);
      const cached = await getCached(cacheKey);
      if (cached) {
        return res.json({ success: true, data: cached });
      }

      const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: {
          lat,
          lon: lng,
          format: 'json',
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'BPA-Location-System/1.0',
        },
        timeout: 10000,
      });

      const result = {
        display_name: response.data.display_name || '',
        name: response.data.name || '',
        lat: response.data.lat,
        lon: response.data.lon,
        address: response.data.address || {},
      };

      await setCache(cacheKey, result);
      return res.json({ success: true, data: result });
    }

    return res.status(400).json({ success: false, message: 'Either query or latitude/longitude is required' });
  } catch (e) {
    console.error('Geocoding error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Geocoding service error' });
  }
};

exports.reverseGeocode = async (req, res) => {
  try {
    const { latitude, longitude } = req.body || {};

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Invalid latitude or longitude' });
    }

    const cacheKey = getCacheKey('reverse', `${lat.toFixed(4)},${lng.toFixed(4)}`);
    const cached = await getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat,
        lon: lng,
        format: 'json',
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'BPA-Location-System/1.0',
      },
      timeout: 10000,
    });

    const result = {
      display_name: response.data.display_name || '',
      name: response.data.name || '',
      lat: response.data.lat,
      lon: response.data.lon,
      address: response.data.address || {},
    };

    // Try to match with BD_AREA or DHAKA_AREA using coordinate-based matching
    let matchedLocation = null;
    try {
      const prisma = getPrisma(req);
      // Use the location matcher service for accurate coordinate-based matching
      const match = await matchCoordinatesToLocation(prisma, lat, lng, 10); // 10km max distance

      if (match && match.confidence >= 0.4) {
        // Only use match if confidence is reasonable
        matchedLocation = {
          kind: match.kind,
          bdAreaId: match.bdAreaId,
          dhakaAreaId: match.dhakaAreaId,
          cityCorporationId: match.cityCorporationId,
          cityCorporationCode: match.cityCorporationCode,
          divisionId: match.divisionId,
          districtId: match.districtId,
          upazilaId: match.upazilaId,
          nameEn: match.nameEn,
          nameBn: match.nameBn,
          fullPathText: match.fullPathText,
          confidence: match.confidence,
          distance: match.distance,
        };
      } else {
        // Fallback: try text-based matching if coordinate matching failed
        const addressParts = [
          result.address.city || result.address.town || result.address.village,
          result.address.state || result.address.region,
          result.address.country,
        ].filter(Boolean);

        if (addressParts.length > 0) {
          const searchTerm = addressParts[0];
          const bdAreas = await prisma.bdArea.findMany({
            where: {
              OR: [
                { nameEn: { contains: searchTerm, mode: 'insensitive' } },
                { nameBn: { contains: searchTerm, mode: 'insensitive' } },
              ],
            },
            take: 1,
            select: { id: true, nameEn: true, nameBn: true, type: true, upazilaId: true, districtId: true },
          });

          if (bdAreas.length > 0) {
            const fullPathText = await buildBdAreaFullPath(prisma, bdAreas[0]);
            matchedLocation = {
              kind: 'BD_AREA',
              bdAreaId: bdAreas[0].id,
              nameEn: bdAreas[0].nameEn,
              nameBn: bdAreas[0].nameBn,
              fullPathText,
              confidence: 0.3, // Lower confidence for text-based matching
            };
          }
        }
      }
    } catch (matchError) {
      // Ignore matching errors, just return geocoding result
      console.error('Location matching error:', matchError);
    }

    const finalResult = {
      ...result,
      matchedLocation,
    };

    await setCache(cacheKey, finalResult);
    return res.json({ success: true, data: finalResult });
  } catch (e) {
    console.error('Reverse geocoding error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Reverse geocoding service error' });
  }
};

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * GET /api/v1/locations/nearby?latitude=&longitude=&radiusKm=&limit=
 * Returns branches near a point (Haversine). Uses BranchProfileDetails latitude/longitude; optional coverageRadiusKm.
 */
exports.getNearby = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const lat = parseFloat(req.query.latitude);
    const lng = parseFloat(req.query.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
    }
    const radiusKm = Math.min(Math.max(parseFloat(req.query.radiusKm) || 10, 0.5), 100);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const branches = await prisma.branch.findMany({
      where: {
        status: 'PUBLISHED',
        profileDetails: {
          latitude: { not: null },
          longitude: { not: null },
        },
      },
      select: {
        id: true,
        name: true,
        orgId: true,
        org: { select: { id: true, name: true } },
        profileDetails: {
          select: {
            latitude: true,
            longitude: true,
            addressJson: true,
          },
        },
      },
    });

    const out = [];
    for (const b of branches) {
      const pd = b.profileDetails;
      if (!pd || pd.latitude == null || pd.longitude == null) continue;
      const blat = Number(pd.latitude);
      const blng = Number(pd.longitude);
      const distanceKm = haversineKm(lat, lng, blat, blng);
      if (distanceKm > radiusKm) continue;
      const addr = pd.addressJson && typeof pd.addressJson === 'object' ? pd.addressJson : {};
      const formattedAddress = addr.formattedAddress || addr.fullPathText || addr.text || null;
      out.push({
        branchId: b.id,
        name: b.name,
        orgId: b.orgId,
        orgName: b.org?.name || null,
        latitude: blat,
        longitude: blng,
        distanceKm: Math.round(distanceKm * 100) / 100,
        formattedAddress,
        status: 'PUBLISHED',
      });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    const data = out.slice(0, limit);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
