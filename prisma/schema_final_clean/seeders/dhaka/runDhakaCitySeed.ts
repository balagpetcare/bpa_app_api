import type { PrismaClient } from '@prisma/client';
import { dhakaCitySeedData } from '../../data/dhaka_city_seed_data';

type AnyPrisma = PrismaClient & Record<string, any>;

function pickModel(prisma: AnyPrisma, candidates: string[]) {
  for (const name of candidates) {
    if (prisma[name]) return prisma[name];
  }
  return null;
}

export async function runDhakaCitySeed(prisma: PrismaClient) {
  const p = prisma as AnyPrisma;

  // Try to support a couple of common naming variants.
  const Division = pickModel(p, ['bdDivision', 'BdDivision', 'division']);
  const District = pickModel(p, ['bdDistrict', 'BdDistrict', 'district']);
  const CityCorp = pickModel(p, ['bdCityCorporation', 'BdCityCorporation', 'cityCorporation']);
  const Zone = pickModel(p, ['bdCcZone', 'BdCcZone', 'cityZone', 'ccZone']);
  const Ward = pickModel(p, ['bdCcWard', 'BdCcWard', 'cityWard', 'ccWard']);
  const Area = pickModel(p, ['bdCcArea', 'BdCcArea', 'cityArea', 'ccArea']);

  if (!Division || !District || !CityCorp || !Zone || !Ward || !Area) {
    throw new Error(
      [
        'Required Prisma models not found on client.',
        'Expected something like: bdDivision, bdDistrict, bdCityCorporation, bdCcZone, bdCcWard, bdCcArea.',
        'Fix: rename the model access in prisma/seeders/dhaka/runDhakaCitySeed.ts to match your schema.'
      ].join(' ')
    );
  }

  // 1) Ensure Dhaka Division + Dhaka District exist
  const dhakaDivision = await Division.upsert({
    where: { code: dhakaCitySeedData.division.code },
    update: {
      nameEn: dhakaCitySeedData.division.nameEn,
      nameBn: dhakaCitySeedData.division.nameBn
    },
    create: dhakaCitySeedData.division
  });

  const dhakaDistrict = await District.upsert({
    where: { code: dhakaCitySeedData.district.code },
    update: {
      nameEn: dhakaCitySeedData.district.nameEn,
      nameBn: dhakaCitySeedData.district.nameBn,
      divisionId: dhakaDivision.id
    },
    create: {
      ...dhakaCitySeedData.district,
      divisionId: dhakaDivision.id
    }
  });

  // 2) City Corporations: DNCC + DSCC
  const corps: Record<string, any> = {};
  for (const cc of dhakaCitySeedData.cityCorporations) {
    const row = await CityCorp.upsert({
      where: { code: cc.code },
      update: {
        nameEn: cc.nameEn,
        nameBn: cc.nameBn,
        districtId: dhakaDistrict.id
      },
      create: {
        ...cc,
        districtId: dhakaDistrict.id
      }
    });
    corps[cc.code] = row;
  }

  // 3) Zones
  const zones: Record<string, any> = {};
  for (const z of dhakaCitySeedData.zones) {
    const cc = corps[z.cityCorporationCode];
    const row = await Zone.upsert({
      where: { code: z.code },
      update: {
        nameEn: z.nameEn,
        nameBn: z.nameBn,
        cityCorporationId: cc.id
      },
      create: {
        ...z,
        cityCorporationId: cc.id
      }
    });
    zones[z.code] = row;
  }

  // 4) Wards
  const wards: Record<string, any> = {};
  for (const w of dhakaCitySeedData.wards) {
    const cc = corps[w.cityCorporationCode];
    const z = zones[w.zoneCode];
    const row = await Ward.upsert({
      where: { code: w.code },
      update: {
        nameEn: w.nameEn,
        nameBn: w.nameBn,
        cityCorporationId: cc.id,
        zoneId: z.id
      },
      create: {
        ...w,
        cityCorporationId: cc.id,
        zoneId: z.id
      }
    });
    wards[w.code] = row;
  }

  // 5) Areas (Neighbourhoods) under wards (Rampura, Banasree, etc.)
  // Use createMany with skipDuplicates if available; fallback to upsert loop.
  const createMany = Area.createMany ? true : false;

  const areaRows = dhakaCitySeedData.areas.map((a) => {
    const cc = corps[a.cityCorporationCode];
    const w = wards[a.wardCode];
    return {
      code: a.code,
      nameEn: a.nameEn,
      nameBn: a.nameBn,
      cityCorporationId: cc.id,
      wardId: w.id
    };
  });

  if (createMany) {
    await Area.createMany({ data: areaRows, skipDuplicates: true });
  } else {
    for (const a of areaRows) {
      await Area.upsert({
        where: { code: a.code },
        update: {
          nameEn: a.nameEn,
          nameBn: a.nameBn,
          cityCorporationId: a.cityCorporationId,
          wardId: a.wardId
        },
        create: a
      });
    }
  }
}