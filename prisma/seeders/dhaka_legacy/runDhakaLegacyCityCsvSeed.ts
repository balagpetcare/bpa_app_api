import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { pickDelegate } from "../_utils/modelResolver";

type Row = {
  divisionCode: string;
  divisionNameEn: string;
  divisionNameBn: string;
  districtCode: string;
  districtNameEn: string;
  districtNameBn: string;
  upazilaCode: string;
  upazilaNameEn: string;
  upazilaNameBn: string;
  areaCode: string;
  areaNameEn: string;
  areaNameBn: string;
};

function parseCsv(content: string): Row[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift()!;
  const cols = header.split(",").map((s) => s.trim());
  return lines.map((line) => {
    const parts: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
      } else if (ch === "," && !inQ) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    const obj: any = {};
    cols.forEach((c, idx) => (obj[c] = (parts[idx] ?? "").replace(/^"|"$/g, "").trim()));
    return obj as Row;
  });
}

export async function runDhakaLegacyCityCsvSeed(prisma: PrismaClient) {
  console.log("🌱 BPA Dhaka Legacy (Upazila+Area) CSV seed starting...");

  const Division = pickDelegate(prisma as any, ["bdDivision", "BdDivision", "bd_division"], "Division");
  const District = pickDelegate(prisma as any, ["bdDistrict", "BdDistrict", "bd_district"], "District");
  const Upazila = pickDelegate(prisma as any, ["bdUpazila", "BdUpazila", "bd_upazila"], "Upazila");
  const Area = pickDelegate(prisma as any, ["bdArea", "BdArea", "bd_area"], "Area");

  const csvPath = join(__dirname, "data", "dhaka_city_legacy_areas.csv");
  const rows = parseCsv(readFileSync(csvPath, "utf8"));

  // Cache by code
  const divCache = new Map<string, any>();
  const distCache = new Map<string, any>();
  const upaCache = new Map<string, any>();

  for (const r of rows) {
    // Division
    let div = divCache.get(r.divisionCode);
    if (!div) {
      div = await Division.upsert({
        where: { code: r.divisionCode },
        update: {},
        create: { code: r.divisionCode, nameEn: r.divisionNameEn, nameBn: r.divisionNameBn },
      });
      divCache.set(r.divisionCode, div);
    }

    // District
    let dist = distCache.get(r.districtCode);
    if (!dist) {
      dist = await District.upsert({
        where: { code: r.districtCode },
        update: { divisionId: div.id },
        create: {
          code: r.districtCode,
          nameEn: r.districtNameEn,
          nameBn: r.districtNameBn,
          divisionId: div.id,
        },
      });
      distCache.set(r.districtCode, dist);
    }

    // Upazila (we will use DNCC/DSCC as "Upazila" buckets so UI can switch)
    let upa = upaCache.get(r.upazilaCode);
    if (!upa) {
      upa = await Upazila.upsert({
        where: { code: r.upazilaCode },
        update: { districtId: dist.id },
        create: {
          code: r.upazilaCode,
          nameEn: r.upazilaNameEn,
          nameBn: r.upazilaNameBn,
          districtId: dist.id,
        },
      });
      upaCache.set(r.upazilaCode, upa);
    }

    // Area / Neighbourhood
    // NOTE: if your schema uses different FK field name than upazilaId, adjust here.
    await Area.upsert({
      where: { code: r.areaCode },
      update: {
        nameEn: r.areaNameEn,
        nameBn: r.areaNameBn,
        // BdArea schema in this repo uses scalar FK fields (upazilaId, districtId, parentId)
        // and does not have a divisionId column.
        upazilaId: upa.id,
        districtId: dist.id,
        parentId: null,
        type: 'CITY_AREA',
      },
      create: {
        code: r.areaCode,
        nameEn: r.areaNameEn,
        nameBn: r.areaNameBn,
        upazilaId: upa.id,
        districtId: dist.id,
        parentId: null,
        type: 'CITY_AREA',
      },
    });
  }

  console.log(`✅ Seed completed. Inserted/updated ${rows.length} rows from CSV.`);
}