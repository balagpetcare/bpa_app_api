import { PrismaClient } from '@prisma/client';

/**
 * Seeds Dhaka City Corporations as BdArea nodes.
 * Schema in this project uses BdArea (tree) for city corporation -> zone -> ward hierarchy.
 */

export const DHAKA_DIVISION_CODE = 'DIV-6';
export const DHAKA_DISTRICT_CODE = 'DIS-47';

export type SeededCorp = {
  dnccAreaId: number;
  dsccAreaId: number;
  dhakaDistrictId: number;
};

export default async function seedDhakaCityCorporations(prisma: PrismaClient): Promise<SeededCorp> {
  // Reuse master seed output — do not create parallel division/district rows.
  const dhakaDivision = await prisma.bdDivision.findUnique({ where: { code: DHAKA_DIVISION_CODE } });
  const dhakaDistrict = await prisma.bdDistrict.findUnique({ where: { code: DHAKA_DISTRICT_CODE } });
  if (!dhakaDivision || !dhakaDistrict) {
    throw new Error(
      'Dhaka division/district missing. Run `npm run seed:location-master` before `npm run seed:dhaka-city`.',
    );
  }

  // Seed City Corporations as BdArea (type = CITY_CORPORATION)
  const dncc = await prisma.bdArea.upsert({
    where: { code: 'CC-DNCC' },
    update: {
      nameEn: 'Dhaka North City Corporation',
      nameBn: 'ঢাকা উত্তর সিটি কর্পোরেশন',
      type: 'CITY_CORPORATION',
      districtId: dhakaDistrict.id,
      parentId: null,
      upazilaId: null,
    },
    create: {
      code: 'CC-DNCC',
      nameEn: 'Dhaka North City Corporation',
      nameBn: 'ঢাকা উত্তর সিটি কর্পোরেশন',
      type: 'CITY_CORPORATION',
      districtId: dhakaDistrict.id,
    },
  });

  const dscc = await prisma.bdArea.upsert({
    where: { code: 'CC-DSCC' },
    update: {
      nameEn: 'Dhaka South City Corporation',
      nameBn: 'ঢাকা দক্ষিণ সিটি কর্পোরেশন',
      type: 'CITY_CORPORATION',
      districtId: dhakaDistrict.id,
      parentId: null,
      upazilaId: null,
    },
    create: {
      code: 'CC-DSCC',
      nameEn: 'Dhaka South City Corporation',
      nameBn: 'ঢাকা দক্ষিণ সিটি কর্পোরেশন',
      type: 'CITY_CORPORATION',
      districtId: dhakaDistrict.id,
    },
  });

  return {
    dnccAreaId: dncc.id,
    dsccAreaId: dscc.id,
    dhakaDistrictId: dhakaDistrict.id,
  };
}
