/**
 * Global sub-districts / areas (e.g. BD upazilas).
 * Idempotent upsert. Reference: docs/location/world/GLOBAL_LOCATION_SYSTEM.md
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

type UpazilaSeed = { code: string; districtCode: string; nameEn: string };

function readJson<T>(fileName: string): T {
  const p = path.join(__dirname, "..", "..", "seed-data", fileName);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

export default async function seedGlobalSubDistricts(prisma: PrismaClient): Promise<void> {
  let total = 0;

  // Bangladesh: upazilas from seed-data (districtCode = LocationCity.code for BD)
  const bdCountry = await prisma.country.findUnique({ where: { code: "BD" }, select: { id: true } });
  if (bdCountry) {
    const cities = await prisma.locationCity.findMany({
      where: { state: { countryId: bdCountry.id } },
      select: { id: true, code: true },
    });
    const cityIdByCode = new Map<string, number>();
    for (const c of cities) {
      if (c.code != null && c.code !== "") cityIdByCode.set(c.code, c.id);
    }

    try {
      const upazilas = readJson<UpazilaSeed[]>("bd.upazilas.json");
      for (const u of upazilas) {
        const cityId: number | undefined = cityIdByCode.get(u.districtCode);
        if (cityId == null) continue;
        await prisma.locationSubDistrict.upsert({
          where: { cityId_name: { cityId, name: u.nameEn } },
          update: {},
          create: { cityId, name: u.nameEn },
        });
        total++;
      }
    } catch (e) {
      console.warn("⚠️ BD upazilas from seed-data not found:", (e as Error)?.message);
    }
  }

  // Other countries (IN, LK, MY, SG): sub-district level optional per doc; skip or add later
  console.log(`✅ Global location sub-districts seeded: ${total}`);
}
