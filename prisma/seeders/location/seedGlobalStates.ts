/**
 * Global states/divisions/provinces for BD, IN, LK, MY, SG.
 * Idempotent upsert. Reference: docs/location/world/GLOBAL_LOCATION_SYSTEM.md
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

type DivisionSeed = { code: string; nameEn: string };

function readJson<T>(fileName: string): T {
  const p = path.join(__dirname, "..", "..", "seed-data", fileName);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

// India: States & Union Territories (official codes)
const IN_STATES = [
  { code: "AN", name: "Andaman and Nicobar Islands" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CH", name: "Chandigarh" },
  { code: "CT", name: "Chhattisgarh" },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "LA", name: "Ladakh" },
  { code: "LD", name: "Lakshadweep" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "NL", name: "Nagaland" },
  { code: "OR", name: "Odisha" },
  { code: "PY", name: "Puducherry" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TG", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "UT", name: "Uttarakhand" },
  { code: "WB", name: "West Bengal" },
];

// Sri Lanka: 9 provinces
const LK_PROVINCES = [
  { code: "1", name: "Central" },
  { code: "2", name: "Eastern" },
  { code: "3", name: "North Central" },
  { code: "4", name: "Northern" },
  { code: "5", name: "North Western" },
  { code: "6", name: "Sabaragamuwa" },
  { code: "7", name: "Southern" },
  { code: "8", name: "Uva" },
  { code: "9", name: "Western" },
];

// Malaysia: 13 states + 3 federal territories
const MY_STATES = [
  { code: "JHR", name: "Johor" },
  { code: "KDH", name: "Kedah" },
  { code: "KTN", name: "Kelantan" },
  { code: "KUL", name: "Kuala Lumpur" },
  { code: "LBN", name: "Labuan" },
  { code: "MLK", name: "Malacca" },
  { code: "NSN", name: "Negeri Sembilan" },
  { code: "PHG", name: "Pahang" },
  { code: "PNG", name: "Penang" },
  { code: "PRK", name: "Perak" },
  { code: "PLS", name: "Perlis" },
  { code: "PJY", name: "Putrajaya" },
  { code: "SBH", name: "Sabah" },
  { code: "SWK", name: "Sarawak" },
  { code: "SGR", name: "Selangor" },
  { code: "TRG", name: "Terengganu" },
];

// Singapore: single "region" state for hierarchy (planning areas can be cities)
const SG_STATES = [{ code: "SG", name: "Singapore" }];

export default async function seedGlobalStates(prisma: PrismaClient): Promise<void> {
  const countries = await prisma.country.findMany({
    where: { code: { in: ["BD", "IN", "LK", "MY", "SG"] } },
    select: { id: true, code: true },
  });
  const countryByCode = new Map(countries.map((c) => [c.code, c.id]));

  let total = 0;

  // Bangladesh: divisions from seed-data
  const bdId = countryByCode.get("BD");
  if (bdId) {
    try {
      const divisions = readJson<DivisionSeed[]>("bd.divisions.json");
      for (const d of divisions) {
        await prisma.state.upsert({
          where: { countryId_code: { countryId: bdId, code: d.code } },
          update: { name: d.nameEn },
          create: { countryId: bdId, code: d.code, name: d.nameEn },
        });
        total++;
      }
    } catch (e) {
      console.warn("⚠️ BD divisions from seed-data not found, skipping:", (e as Error)?.message);
    }
  }

  // India
  const inId = countryByCode.get("IN");
  if (inId) {
    for (const s of IN_STATES) {
      await prisma.state.upsert({
        where: { countryId_code: { countryId: inId, code: s.code } },
        update: { name: s.name },
        create: { countryId: inId, code: s.code, name: s.name },
      });
      total++;
    }
  }

  // Sri Lanka
  const lkId = countryByCode.get("LK");
  if (lkId) {
    for (const s of LK_PROVINCES) {
      await prisma.state.upsert({
        where: { countryId_code: { countryId: lkId, code: s.code } },
        update: { name: s.name },
        create: { countryId: lkId, code: s.code, name: s.name },
      });
      total++;
    }
  }

  // Malaysia
  const myId = countryByCode.get("MY");
  if (myId) {
    for (const s of MY_STATES) {
      await prisma.state.upsert({
        where: { countryId_code: { countryId: myId, code: s.code } },
        update: { name: s.name },
        create: { countryId: myId, code: s.code, name: s.name },
      });
      total++;
    }
  }

  // Singapore
  const sgId = countryByCode.get("SG");
  if (sgId) {
    for (const s of SG_STATES) {
      await prisma.state.upsert({
        where: { countryId_code: { countryId: sgId, code: s.code } },
        update: { name: s.name },
        create: { countryId: sgId, code: s.code, name: s.name },
      });
      total++;
    }
  }

  console.log(`✅ Global states seeded: ${total}`);
}
