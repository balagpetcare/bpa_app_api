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


  // 5) Dhaka City Corporation hierarchy (District → CityCorp → Zone/Thana → Area/Ward)
  // Uses BdArea with type: CITY_CORPORATION | ZONE | AREA
  const dhakaDistrictId = disIdByCode.get("DIS-47") ?? null;
  if (dhakaDistrictId) {
    const cityCorps = [
      { code: "CC-DNCC", nameEn: "Dhaka North City Corporation", nameBn: "ঢাকা উত্তর সিটি কর্পোরেশন" },
      { code: "CC-DSCC", nameEn: "Dhaka South City Corporation", nameBn: "ঢাকা দক্ষিণ সিটি কর্পোরেশন" },
    ];

    const ccRows = {};
    for (const cc of cityCorps) {
      const row = await prisma.bdArea.upsert({
        where: { code: cc.code },
        update: {
          nameEn: cc.nameEn,
          nameBn: cc.nameBn ?? null,
          type: "CITY_CORPORATION",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId: null,
        },
        create: {
          code: cc.code,
          nameEn: cc.nameEn,
          nameBn: cc.nameBn ?? null,
          type: "CITY_CORPORATION",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId: null,
        },
      });
      ccRows[cc.code] = row;
    }

    const zones = [
      // DNCC
      { code: "ZONE-DNCC-GULSHAN", ccCode: "CC-DNCC", nameEn: "Gulshan", nameBn: "গুলশান" },
      { code: "ZONE-DNCC-UTTARA", ccCode: "CC-DNCC", nameEn: "Uttara", nameBn: "উত্তরা" },
      { code: "ZONE-DNCC-MIRPUR", ccCode: "CC-DNCC", nameEn: "Mirpur", nameBn: "মিরপুর" },

      // DSCC
      { code: "ZONE-DSCC-RAMPURA", ccCode: "CC-DSCC", nameEn: "Rampura", nameBn: "রামপুরা" },
      { code: "ZONE-DSCC-DHANMONDI", ccCode: "CC-DSCC", nameEn: "Dhanmondi", nameBn: "ধানমন্ডি" },
    ];

    const zoneRows = {};
    for (const z of zones) {
      const parentId = ccRows[z.ccCode].id;
      const row = await prisma.bdArea.upsert({
        where: { code: z.code },
        update: {
          nameEn: z.nameEn,
          nameBn: z.nameBn ?? null,
          type: "ZONE",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId,
        },
        create: {
          code: z.code,
          nameEn: z.nameEn,
          nameBn: z.nameBn ?? null,
          type: "ZONE",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId,
        },
      });
      zoneRows[z.code] = row;
    }

    const areasDhaka = [
      // Gulshan
      { code: "AREA-GULSHAN-1", zoneCode: "ZONE-DNCC-GULSHAN", nameEn: "Gulshan 1", nameBn: "গুলশান ১" },
      { code: "AREA-GULSHAN-2", zoneCode: "ZONE-DNCC-GULSHAN", nameEn: "Gulshan 2", nameBn: "গুলশান ২" },

      // Uttara
      { code: "AREA-UTTARA-7", zoneCode: "ZONE-DNCC-UTTARA", nameEn: "Uttara 7", nameBn: "উত্তরা ৭" },
      { code: "AREA-UTTARA-11", zoneCode: "ZONE-DNCC-UTTARA", nameEn: "Uttara 11", nameBn: "উত্তরা ১১" },

      // Mirpur
      { code: "AREA-MIRPUR-10", zoneCode: "ZONE-DNCC-MIRPUR", nameEn: "Mirpur 10", nameBn: "মিরপুর ১০" },

      // Rampura + Banasree variants
      { code: "AREA-RAMPURA", zoneCode: "ZONE-DSCC-RAMPURA", nameEn: "Rampura", nameBn: "রামপুরা" },
      { code: "AREA-BANASREE", zoneCode: "ZONE-DSCC-RAMPURA", nameEn: "Banasree", nameBn: "বনশ্রী" },
      { code: "AREA-BANASREE-SOUTH", zoneCode: "ZONE-DSCC-RAMPURA", nameEn: "South Banasree", nameBn: "দক্ষিণ বনশ্রী" },

      // Dhanmondi
      { code: "AREA-DHANMONDI-27", zoneCode: "ZONE-DSCC-DHANMONDI", nameEn: "Dhanmondi 27", nameBn: "ধানমন্ডি ২৭" },
    ];

    for (const a of areasDhaka) {
      const parentId = zoneRows[a.zoneCode].id;
      await prisma.bdArea.upsert({
        where: { code: a.code },
        update: {
          nameEn: a.nameEn,
          nameBn: a.nameBn ?? null,
          type: "AREA",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId,
        },
        create: {
          code: a.code,
          nameEn: a.nameEn,
          nameBn: a.nameBn ?? null,
          type: "AREA",
          districtId: dhakaDistrictId,
          upazilaId: null,
          parentId,
        },
      });
    }

    console.log("🏙️ Dhaka City Corporation areas seeded (sample set).");
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
