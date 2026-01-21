/**
 * (B) Seed DNCC/DSCC + Areas (Ward বাদ)
 * CommonJS, works with: node prisma/seed.js
 */

const { PrismaClient } = require("@prisma/client");

/**
 * Minimal demo dataset.
 * You should expand this list gradually (CSV -> import later).
 */
const CORPS = [
  { code: "DNCC", nameEn: "Dhaka North City Corporation", nameBn: "ঢাকা উত্তর সিটি কর্পোরেশন" },
  { code: "DSCC", nameEn: "Dhaka South City Corporation", nameBn: "ঢাকা দক্ষিণ সিটি কর্পোরেশন" },
];

// Areas: parentId is optional for sub-areas/blocks
const AREAS = [
  // DNCC samples
  { corp: "DNCC", nameEn: "Banasree", nameBn: "বনশ্রী", searchKeywords: "banasree, block a, block b" },
  { corp: "DNCC", nameEn: "Rampura", nameBn: "রামপুরা", searchKeywords: "rampura" },
  { corp: "DNCC", nameEn: "Badda", nameBn: "বাড্ডা", searchKeywords: "badda, north badda" },
  { corp: "DNCC", nameEn: "Mirpur 10", nameBn: "মিরপুর ১০", searchKeywords: "mirpur 10" },

  // DSCC samples
  { corp: "DSCC", nameEn: "Dhanmondi 15", nameBn: "ধানমন্ডি ১৫", searchKeywords: "dhanmondi 15" },
  { corp: "DSCC", nameEn: "Dhanmondi 27", nameBn: "ধানমন্ডি ২৭", searchKeywords: "dhanmondi 27" },
  { corp: "DSCC", nameEn: "Lalbagh", nameBn: "লালবাগ", searchKeywords: "lalbagh, old dhaka" },
];

/**
 * Helper: find or create area uniquely.
 * Note: composite unique with nullable parentId can be tricky; we do findFirst -> update/create.
 */
async function upsertArea(prisma, { cityCorporationId, parentId = null, nameEn, nameBn, searchKeywords }) {
  const existing = await prisma.area.findFirst({
    where: { cityCorporationId, parentId, nameEn },
  });

  if (existing) {
    return prisma.area.update({
      where: { id: existing.id },
      data: { nameBn, searchKeywords: searchKeywords || null },
    });
  }

  return prisma.area.create({
    data: {
      cityCorporationId,
      parentId,
      nameEn,
      nameBn,
      searchKeywords: searchKeywords || null,
    },
  });
}

async function seedCityCorporationsAndAreas(prisma) {
  // 1) corps
  const corpMap = {};
  for (const c of CORPS) {
    const row = await prisma.cityCorporation.upsert({
      where: { code: c.code },
      update: { nameEn: c.nameEn, nameBn: c.nameBn },
      create: { code: c.code, nameEn: c.nameEn, nameBn: c.nameBn },
    });
    corpMap[c.code] = row;
  }

  // 2) areas
  for (const a of AREAS) {
    const corp = corpMap[a.corp];
    if (!corp) continue;
    await upsertArea(prisma, {
      cityCorporationId: corp.id,
      parentId: null,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      searchKeywords: a.searchKeywords,
    });
  }

  return { corps: Object.keys(corpMap).length, areas: AREAS.length };
}

module.exports = { seedCityCorporationsAndAreas };
