import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

type DivisionSeed = { code: string; nameEn: string; nameBn?: string };
type DistrictSeed = { code: string; divisionCode: string; nameEn: string; nameBn?: string };
type UpazilaSeed = { code: string; districtCode: string; nameEn: string; nameBn?: string };
type AreaSeed = {
  code: string;
  upazilaCode?: string;
  districtCode?: string;
  unionCode?: string;
  parentCode?: string;
  nameEn: string;
  nameBn?: string;
  type: string;
};

type IdCodeRow = { id: number; code: string };

function buildIdByCodeMap(rows: IdCodeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

function lookupId(map: Map<string, number>, code: string | undefined): number | null {
  if (!code) return null;
  return map.get(code) ?? null;
}

function resolveUnionId(area: AreaSeed, unionIdByCode: Map<string, number>): number | null {
  if (area.unionCode) {
    return lookupId(unionIdByCode, area.unionCode);
  }
  if (String(area.type || '').toUpperCase() === 'UNION') {
    return lookupId(unionIdByCode, area.code);
  }
  return null;
}

function resolveSeedDataDir(): string {
  const candidates = [
    path.join(__dirname, '..', 'seed-data'),
    path.join(__dirname, '..', 'schema_final_clean', 'seed-data'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bd.divisions.json'))) return dir;
  }
  return candidates[0];
}

const SEED_DATA_DIR = resolveSeedDataDir();

function readJsonIfExists<T>(fileName: string): T | null {
  try {
    const p = path.join(SEED_DATA_DIR, fileName);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Seeds Bangladesh base locations from prisma/seed-data:
 *  - bd.divisions.json
 *  - bd.districts.json
 *  - bd.upazilas.json
 *  - bd.areas.json
 * Skips gracefully if seed-data folder or any file is missing.
 */
export default async function seedBaseBdLocations(prisma: PrismaClient) {
  const divisions = readJsonIfExists<DivisionSeed[]>('bd.divisions.json');
  if (!divisions || divisions.length === 0) {
    console.warn('⚠️ seedBaseBdLocations skipped: prisma/seed-data/bd.divisions.json not found or empty');
    return;
  }
  const districts = readJsonIfExists<DistrictSeed[]>('bd.districts.json') ?? [];
  const upazilas = readJsonIfExists<UpazilaSeed[]>('bd.upazilas.json') ?? [];
  const areas = readJsonIfExists<AreaSeed[]>('bd.areas.json') ?? [];

  // 1) Divisions
  for (const d of divisions) {
    await prisma.bdDivision.upsert({
      where: { code: d.code },
      update: { nameEn: d.nameEn, nameBn: d.nameBn ?? null },
      create: { code: d.code, nameEn: d.nameEn, nameBn: d.nameBn ?? null },
    });
  }

  const divRows = await prisma.bdDivision.findMany({ select: { id: true, code: true } });
  const divIdByCode = buildIdByCodeMap(divRows);

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

  const disRows = await prisma.bdDistrict.findMany({ select: { id: true, code: true } });
  const disIdByCode = buildIdByCodeMap(disRows);

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

  const upzRows = await prisma.bdUpazila.findMany({ select: { id: true, code: true } });
  const upzIdByCode = buildIdByCodeMap(upzRows);

  // 4) Canonical unions (new centralized level)
  const unionSeeds = areas.filter((a) => String(a.type || '').toUpperCase() === 'UNION');
  for (const u of unionSeeds) {
    const upazilaId = lookupId(upzIdByCode, u.upazilaCode);
    if (upazilaId === null) continue;
    await prisma.bdUnion.upsert({
      where: { code: u.code },
      update: {
        nameEn: u.nameEn,
        nameBn: u.nameBn ?? null,
        upazilaId,
      },
      create: {
        code: u.code,
        nameEn: u.nameEn,
        nameBn: u.nameBn ?? null,
        upazilaId,
      },
    });
  }

  const unionRows = await prisma.bdUnion.findMany({ select: { id: true, code: true } });
  const unionIdByCode = buildIdByCodeMap(unionRows);

  // 5) Legacy-compatible bd_areas (kept for backward compatibility)
  for (const a of areas) {
    const upazilaId = lookupId(upzIdByCode, a.upazilaCode);
    const districtId = lookupId(disIdByCode, a.districtCode);
    const unionId = resolveUnionId(a, unionIdByCode);
    await prisma.bdArea.upsert({
      where: { code: a.code },
      update: {
        nameEn: a.nameEn,
        nameBn: a.nameBn ?? null,
        type: a.type,
        unionId,
        upazilaId,
        districtId,
        parentId: null,
      },
      create: {
        code: a.code,
        nameEn: a.nameEn,
        nameBn: a.nameBn ?? null,
        type: a.type,
        unionId,
        upazilaId,
        districtId,
        parentId: null,
      },
    });
  }
}
