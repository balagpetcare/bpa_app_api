/**
 * Global cities/districts for BD, IN, LK, MY, SG.
 * Idempotent upsert. Reference: docs/location/world/GLOBAL_LOCATION_SYSTEM.md
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

type DistrictSeed = { code: string; divisionCode: string; nameEn: string };

function readJson<T>(fileName: string): T {
  const p = path.join(__dirname, "..", "..", "seed-data", fileName);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

// Sri Lanka: districts by province code (1-9)
const LK_DISTRICTS: { stateCode: string; name: string }[] = [
  { stateCode: "1", name: "Kandy" },
  { stateCode: "1", name: "Matale" },
  { stateCode: "1", name: "Nuwara Eliya" },
  { stateCode: "2", name: "Ampara" },
  { stateCode: "2", name: "Batticaloa" },
  { stateCode: "2", name: "Trincomalee" },
  { stateCode: "3", name: "Anuradhapura" },
  { stateCode: "3", name: "Polonnaruwa" },
  { stateCode: "4", name: "Jaffna" },
  { stateCode: "4", name: "Kilinochchi" },
  { stateCode: "4", name: "Mannar" },
  { stateCode: "4", name: "Mullaitivu" },
  { stateCode: "4", name: "Vavuniya" },
  { stateCode: "5", name: "Kurunegala" },
  { stateCode: "5", name: "Puttalam" },
  { stateCode: "6", name: "Kegalle" },
  { stateCode: "6", name: "Ratnapura" },
  { stateCode: "7", name: "Galle" },
  { stateCode: "7", name: "Hambantota" },
  { stateCode: "7", name: "Matara" },
  { stateCode: "8", name: "Badulla" },
  { stateCode: "8", name: "Monaragala" },
  { stateCode: "9", name: "Colombo" },
  { stateCode: "9", name: "Gampaha" },
  { stateCode: "9", name: "Kalutara" },
];

// Malaysia: major cities by state code
const MY_CITIES: { stateCode: string; name: string }[] = [
  { stateCode: "JHR", name: "Johor Bahru" },
  { stateCode: "JHR", name: "Iskandar Puteri" },
  { stateCode: "KDH", name: "Alor Setar" },
  { stateCode: "KTN", name: "Kota Bharu" },
  { stateCode: "KUL", name: "Kuala Lumpur" },
  { stateCode: "MLK", name: "Malacca City" },
  { stateCode: "NSN", name: "Seremban" },
  { stateCode: "PHG", name: "Kuantan" },
  { stateCode: "PNG", name: "George Town" },
  { stateCode: "PRK", name: "Ipoh" },
  { stateCode: "PLS", name: "Kangar" },
  { stateCode: "SBH", name: "Kota Kinabalu" },
  { stateCode: "SWK", name: "Kuching" },
  { stateCode: "SGR", name: "Shah Alam" },
  { stateCode: "SGR", name: "Petaling Jaya" },
  { stateCode: "TRG", name: "Kuala Terengganu" },
];

// Singapore: planning areas / regions
const SG_AREAS = [
  "Ang Mo Kio", "Bedok", "Bishan", "Bukit Batok", "Bukit Merah", "Choa Chu Kang",
  "Clementi", "Geylang", "Hougang", "Jurong East", "Jurong West", "Kallang",
  "Marine Parade", "Pasir Ris", "Punggol", "Queenstown", "Sembawang", "Sengkang",
  "Serangoon", "Tampines", "Toa Payoh", "Woodlands", "Yishun", "Central Area",
];

// India: major cities (one or two per state/UT) - representative set
const IN_CITIES: { stateCode: string; name: string }[] = [
  { stateCode: "AP", name: "Visakhapatnam" },
  { stateCode: "AP", name: "Amaravati" },
  { stateCode: "AS", name: "Guwahati" },
  { stateCode: "BR", name: "Patna" },
  { stateCode: "CH", name: "Chandigarh" },
  { stateCode: "CT", name: "Raipur" },
  { stateCode: "DL", name: "New Delhi" },
  { stateCode: "GA", name: "Panaji" },
  { stateCode: "GJ", name: "Ahmedabad" },
  { stateCode: "GJ", name: "Gandhinagar" },
  { stateCode: "HR", name: "Gurgaon" },
  { stateCode: "HP", name: "Shimla" },
  { stateCode: "JK", name: "Srinagar" },
  { stateCode: "JH", name: "Ranchi" },
  { stateCode: "KA", name: "Bengaluru" },
  { stateCode: "KL", name: "Thiruvananthapuram" },
  { stateCode: "MP", name: "Bhopal" },
  { stateCode: "MP", name: "Indore" },
  { stateCode: "MH", name: "Mumbai" },
  { stateCode: "MH", name: "Pune" },
  { stateCode: "MN", name: "Imphal" },
  { stateCode: "ML", name: "Shillong" },
  { stateCode: "MZ", name: "Aizawl" },
  { stateCode: "NL", name: "Kohima" },
  { stateCode: "OR", name: "Bhubaneswar" },
  { stateCode: "PB", name: "Chandigarh" },
  { stateCode: "RJ", name: "Jaipur" },
  { stateCode: "TN", name: "Chennai" },
  { stateCode: "TG", name: "Hyderabad" },
  { stateCode: "UP", name: "Lucknow" },
  { stateCode: "UP", name: "Kanpur" },
  { stateCode: "UT", name: "Dehradun" },
  { stateCode: "WB", name: "Kolkata" },
];

export default async function seedGlobalCities(prisma: PrismaClient): Promise<void> {
  const states = await prisma.state.findMany({
    where: { country: { code: { in: ["BD", "IN", "LK", "MY", "SG"] } } },
    select: { id: true, code: true, country: { select: { code: true } } },
  });
  const stateByCountryAndCode = new Map(states.map((s) => [`${s.country.code}:${s.code}`, s.id]));
  const getStateId = (countryCode: string, stateCode: string) =>
    stateByCountryAndCode.get(`${countryCode}:${stateCode}`);

  let total = 0;

  // Bangladesh: districts from seed-data (district = city in hierarchy)
  try {
    const districts = readJson<DistrictSeed[]>("bd.districts.json");
    for (const d of districts) {
      const stateId = getStateId("BD", d.divisionCode);
      if (!stateId) continue;
      await prisma.locationCity.upsert({
        where: { stateId_name: { stateId, name: d.nameEn } },
        update: { code: d.code },
        create: { stateId, name: d.nameEn, code: d.code },
      });
      total++;
    }
  } catch (e) {
    console.warn("⚠️ BD districts from seed-data not found:", (e as Error)?.message);
  }

  // India
  for (const c of IN_CITIES) {
    const stateId = getStateId("IN", c.stateCode);
    if (!stateId) continue;
    await prisma.locationCity.upsert({
      where: { stateId_name: { stateId, name: c.name } },
      update: {},
      create: { stateId, name: c.name },
    });
    total++;
  }

  // Sri Lanka
  const sgStateId = getStateId("SG", "SG");
  for (const c of LK_DISTRICTS) {
    const stateId = getStateId("LK", c.stateCode);
    if (!stateId) continue;
    await prisma.locationCity.upsert({
      where: { stateId_name: { stateId, name: c.name } },
      update: {},
      create: { stateId, name: c.name },
    });
    total++;
  }

  // Malaysia
  for (const c of MY_CITIES) {
    const stateId = getStateId("MY", c.stateCode);
    if (!stateId) continue;
    await prisma.locationCity.upsert({
      where: { stateId_name: { stateId, name: c.name } },
      update: {},
      create: { stateId, name: c.name },
    });
    total++;
  }

  // Singapore: planning areas as cities under state "SG"
  if (sgStateId) {
    for (const name of SG_AREAS) {
      await prisma.locationCity.upsert({
        where: { stateId_name: { stateId: sgStateId, name } },
        update: {},
        create: { stateId: sgStateId, name },
      });
      total++;
    }
  }

  console.log(`✅ Global location cities seeded: ${total}`);
}
