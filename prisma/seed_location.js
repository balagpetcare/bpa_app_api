const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

function readJson(file) {
  const p = path.join(__dirname, "seed-data", file);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function seedLocations() {
  console.log("📍 Seeding Bangladesh Locations (Division → District → Upazila → Area) ...");

  const divisions = readJson("bd.divisions.json");
  const districts = readJson("bd.districts.json");
  const upazilas = readJson("bd.upazilas.json");
  const areas = readJson("bd.areas.json"); // unions as areas

  // 1) Divisions
  for (const d of divisions) {
    await prisma.bdDivision.upsert({
      where: { code: d.code },
      update: { nameEn: d.nameEn, nameBn: d.nameBn ?? null },
      create: { code: d.code, nameEn: d.nameEn, nameBn: d.nameBn ?? null },
    });
  }

  // Build divisionCode -> id map
  const divRows = await prisma.bdDivision.findMany({ select: { id: true, code: true } });
  const divIdByCode = new Map(divRows.map((r) => [r.code, r.id]));

  // 2) Districts
  for (const dis of districts) {
    const divisionId = divIdByCode.get(dis.divisionCode);
    if (!divisionId) continue;

    await prisma.bdDistrict.upsert({
      where: { code: dis.code },
      update: { nameEn: dis.nameEn, nameBn: dis.nameBn ?? null, divisionId },
      create: { code: dis.code, nameEn: dis.nameEn, nameBn: dis.nameBn ?? null, divisionId },
    });
  }

  // Build districtCode -> id map
  const disRows = await prisma.bdDistrict.findMany({ select: { id: true, code: true } });
  const disIdByCode = new Map(disRows.map((r) => [r.code, r.id]));

  // 3) Upazilas
  for (const upz of upazilas) {
    const districtId = disIdByCode.get(upz.districtCode);
    if (!districtId) continue;

    await prisma.bdUpazila.upsert({
      where: { code: upz.code },
      update: { nameEn: upz.nameEn, nameBn: upz.nameBn ?? null, districtId },
      create: { code: upz.code, nameEn: upz.nameEn, nameBn: upz.nameBn ?? null, districtId },
    });
  }

  // Build upazilaCode -> id map
  const upzRows = await prisma.bdUpazila.findMany({ select: { id: true, code: true } });
  const upzIdByCode = new Map(upzRows.map((r) => [r.code, r.id]));

  // 4) Areas (Unions)
  for (const a of areas) {
    const upazilaId = a.upazilaCode ? (upzIdByCode.get(a.upazilaCode) ?? null) : null;

    await prisma.bdArea.upsert({
      where: { code: a.code },
      update: { nameEn: a.nameEn, nameBn: a.nameBn ?? null, type: a.type, upazilaId },
      create: { code: a.code, nameEn: a.nameEn, nameBn: a.nameBn ?? null, type: a.type, upazilaId },
    });
  }

  console.log("✅ Bangladesh Locations seed done.");
}

module.exports = seedLocations;

if (require.main === module) {
  seedLocations()
    .catch((e) => {
      console.error("❌ Location seed failed:", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
