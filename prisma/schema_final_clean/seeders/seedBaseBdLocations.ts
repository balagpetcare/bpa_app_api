import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

type DivisionSeed = { code: string; nameEn: string; nameBn?: string };
type DistrictSeed = { code: string; divisionCode: string; nameEn: string; nameBn?: string };
type UpazilaSeed = { code: string; districtCode: string; nameEn: string; nameBn?: string };
type AreaSeed = { code: string; upazilaCode?: string; nameEn: string; nameBn?: string; type: string };

function readJson<T>(fileName: string): T {
  const p = path.join(__dirname, '..', 'seed-data', fileName);
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

/**
 * Seeds Bangladesh base locations from prisma/seed-data:
 *  - bd.divisions.json
 *  - bd.districts.json
 *  - bd.upazilas.json
 *  - bd.areas.json
 */
export default async function seedBaseBdLocations(prisma: PrismaClient) {
  const divisions = readJson<DivisionSeed[]>('bd.divisions.json');
  const districts = readJson<DistrictSeed[]>('bd.districts.json');
  const upazilas = readJson<UpazilaSeed[]>('bd.upazilas.json');
  const areas = readJson<AreaSeed[]>('bd.areas.json');

  // 1) Divisions
  for (const d of divisions) {
    await prisma.bdDivision.upsert({
      where: { code: d.code },
      update: { nameEn: d.nameEn, nameBn: d.nameBn ?? null },
      create: { code: d.code, nameEn: d.nameEn, nameBn: d.nameBn ?? null },
    });
  }

  const divRows = await prisma.bdDivision.findMany({ select: { id: true, code: true } });
  const divIdByCode = new Map(divRows.map((r) => [r.code, r.id] as const));

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
  const disIdByCode = new Map(disRows.map((r) => [r.code, r.id] as const));

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
  const upzIdByCode = new Map(upzRows.map((r) => [r.code, r.id] as const));

  // 4) Legacy areas (union/area under upazila)
  for (const a of areas) {
    const upazilaId = a.upazilaCode ? (upzIdByCode.get(a.upazilaCode) ?? null) : null;
    await prisma.bdArea.upsert({
      where: { code: a.code },
      update: {
        nameEn: a.nameEn,
        nameBn: a.nameBn ?? null,
        type: a.type,
        upazilaId,
        districtId: null,
        parentId: null,
      },
      create: {
        code: a.code,
        nameEn: a.nameEn,
        nameBn: a.nameBn ?? null,
        type: a.type,
        upazilaId,
        districtId: null,
        parentId: null,
      },
    });
  }
}
