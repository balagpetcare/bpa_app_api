/*
  Requires prisma injected via req.prisma (recommended) OR require your prisma singleton.
  If you already have prisma instance on req: use req.prisma.
*/

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
    const prisma = getPrisma(req);
    const rows = await prisma.bdDivision.findMany({
      orderBy: { nameEn: 'asc' },
      select: { id: true, code: true, nameEn: true, nameBn: true }
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listDistricts = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const divisionId = asInt(req.query.divisionId);
    const q = safeStr(req.query.q).trim();
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 200);

    const rows = await prisma.bdDistrict.findMany({
      where: {
        ...(divisionId ? { divisionId } : {}),
        ...(q
          ? { OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { nameBn: { contains: q, mode: 'insensitive' } }] }
          : {})
      },
      orderBy: { nameEn: 'asc' },
      take: limit,
      select: { id: true, code: true, nameEn: true, nameBn: true, divisionId: true }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listUpazilas = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const districtId = asInt(req.query.districtId);
    const q = safeStr(req.query.q).trim();
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 300);

    const rows = await prisma.bdUpazila.findMany({
      where: {
        ...(districtId ? { districtId } : {}),
        ...(q
          ? { OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { nameBn: { contains: q, mode: 'insensitive' } }] }
          : {})
      },
      orderBy: { nameEn: 'asc' },
      take: limit,
      select: { id: true, code: true, nameEn: true, nameBn: true, districtId: true }
    });

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

exports.listBdAreas = async (req, res) => {
  try {
    const prisma = getPrisma(req);
    const upazilaId = asInt(req.query.upazilaId);
    const districtId = asInt(req.query.districtId);
    const parentId = req.query.parentId !== undefined ? asInt(req.query.parentId) : undefined;
    const q = safeStr(req.query.q).trim();
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 400);

    const rows = await prisma.bdArea.findMany({
      where: {
        ...(upazilaId ? { upazilaId } : {}),
        ...(districtId ? { districtId } : {}),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
        ...(q
          ? { OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { nameBn: { contains: q, mode: 'insensitive' } }] }
          : {})
      },
      orderBy: { nameEn: 'asc' },
      take: limit,
      select: { id: true, code: true, nameEn: true, nameBn: true, type: true, upazilaId: true, districtId: true, parentId: true }
    });

    res.json({ success: true, data: rows });
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
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);
    if (!q) return res.json({ success: true, data: [] });

    // 1) Search BD areas
    const bdRows = await prisma.bdArea.findMany({
      where: {
        OR: [
          { nameEn: { contains: q, mode: 'insensitive' } },
          { nameBn: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: limit,
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameBn: true, type: true, upazilaId: true, districtId: true, parentId: true }
    });

    const bdItems = [];
    for (const r of bdRows) {
      // eslint-disable-next-line no-await-in-loop
      const fullPathText = await buildBdAreaFullPath(prisma, r);
      bdItems.push({
        kind: 'BD_AREA',
        bdAreaId: r.id,
        nameEn: r.nameEn,
        nameBn: r.nameBn,
        type: r.type,
        fullPathText
      });
      if (bdItems.length >= limit) break;
    }

    // 2) Search Dhaka fast areas (optional)
    const dhakaRows = await prisma.area.findMany({
      where: {
        OR: [
          { nameEn: { contains: q, mode: 'insensitive' } },
          { nameBn: { contains: q, mode: 'insensitive' } },
          { searchKeywords: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: limit,
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameBn: true, parentId: true, cityCorporationId: true }
    });

    const dhakaItems = [];
    for (const r of dhakaRows) {
      // eslint-disable-next-line no-await-in-loop
      const corp = await prisma.cityCorporation.findUnique({ where: { id: r.cityCorporationId }, select: { code: true, nameEn: true, nameBn: true } });
      // eslint-disable-next-line no-await-in-loop
      const { names } = await buildDhakaAreaPath(prisma, r.id);
      const corpName = corp?.nameEn || corp?.nameBn || corp?.code;
      const fullPathText = [corpName, ...names.reverse()].filter(Boolean).join(' > ');
      dhakaItems.push({
        kind: 'DHAKA_AREA',
        cityCorporationId: r.cityCorporationId,
        dhakaAreaId: r.id,
        nameEn: r.nameEn,
        nameBn: r.nameBn,
        fullPathText,
        cityCorporationCode: corp?.code || null
      });
      if (dhakaItems.length >= limit) break;
    }

    // Merge + cap
    const data = [...bdItems, ...dhakaItems].slice(0, limit);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
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
        select: { id: true, nameEn: true, nameBn: true, type: true, upazilaId: true, districtId: true, parentId: true }
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
          fullPathText
        }
      });
    }

    const r = await prisma.area.findUnique({
      where: { id: dhakaAreaId },
      select: { id: true, nameEn: true, nameBn: true, parentId: true, cityCorporationId: true }
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
        fullPathText
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
};

export {};
