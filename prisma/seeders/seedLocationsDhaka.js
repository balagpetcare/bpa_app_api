/*
  Seed: DNCC/DSCC + Areas (Ward বাদ)
  Usage:
    const { seedLocationsDhaka } = require('./seeders/seedLocationsDhaka');
    await seedLocationsDhaka(prisma);
*/

const fs = require('fs');
const path = require('path');

function normalize(str) {
  return String(str || '').trim();
}

async function upsertCityCorporation(prisma, corp) {
  const code = normalize(corp.code).toUpperCase();
  if (!code) throw new Error('CityCorporation.code required');

  return prisma.cityCorporation.upsert({
    where: { code },
    update: {
      nameEn: normalize(corp.nameEn),
      nameBn: normalize(corp.nameBn)
    },
    create: {
      code,
      nameEn: normalize(corp.nameEn),
      nameBn: normalize(corp.nameBn)
    }
  });
}

async function findArea(prisma, { cityCorporationId, parentId, nameEn }) {
  // Upsert with optional parentId can be tricky if parentId is null across DBs.
  // So we do findFirst then update/create.
  return prisma.area.findFirst({
    where: {
      cityCorporationId,
      parentId: parentId || null,
      nameEn
    }
  });
}

async function upsertArea(prisma, { cityCorporationId, parentId, nameEn, nameBn, searchKeywords }) {
  const cleaned = {
    cityCorporationId,
    parentId: parentId || null,
    nameEn: normalize(nameEn),
    nameBn: normalize(nameBn || nameEn),
    searchKeywords: searchKeywords ? normalize(searchKeywords) : null
  };

  if (!cleaned.nameEn) throw new Error('Area.nameEn required');

  const existing = await findArea(prisma, {
    cityCorporationId: cleaned.cityCorporationId,
    parentId: cleaned.parentId,
    nameEn: cleaned.nameEn
  });

  if (existing) {
    return prisma.area.update({
      where: { id: existing.id },
      data: {
        nameBn: cleaned.nameBn,
        searchKeywords: cleaned.searchKeywords
      }
    });
  }

  return prisma.area.create({ data: cleaned });
}

async function seedLocationsDhaka(prisma, options = {}) {
  const dataPath = options.dataPath || path.join(__dirname, 'data', 'dncc_dscc_areas.sample.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  const data = JSON.parse(raw);

  // 1) Corps
  const corpMap = new Map();
  for (const corp of data.corporations || []) {
    const saved = await upsertCityCorporation(prisma, corp);
    corpMap.set(saved.code, saved);
  }

  // 2) Areas
  const areasByCorp = data.areas || {};
  for (const corpCode of Object.keys(areasByCorp)) {
    const corp = corpMap.get(String(corpCode).toUpperCase());
    if (!corp) throw new Error(`CityCorporation not found for code=${corpCode}`);

    for (const a of areasByCorp[corpCode] || []) {
      await upsertArea(prisma, {
        cityCorporationId: corp.id,
        parentId: null,
        nameEn: a.nameEn,
        nameBn: a.nameBn,
        searchKeywords: a.keywords
      });
    }
  }

  return { corporationsSeeded: corpMap.size };
}

module.exports = { seedLocationsDhaka };
