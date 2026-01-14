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
  // Ensure Dhaka Division exists
  const dhakaDivision = await prisma.bdDivision.upsert({
    where: { code: DHAKA_DIVISION_CODE },
    update: { nameEn: 'Dhaka', nameBn: 'ঢাকা' },
    create: { code: DHAKA_DIVISION_CODE, nameEn: 'Dhaka', nameBn: 'ঢাকা' },
  });

  // Ensure Dhaka District exists
  const dhakaDistrict = await prisma.bdDistrict.upsert({
    where: { code: DHAKA_DISTRICT_CODE },
    update: { nameEn: 'Dhaka', nameBn: 'ঢাকা', divisionId: dhakaDivision.id },
    create: { code: DHAKA_DISTRICT_CODE, nameEn: 'Dhaka', nameBn: 'ঢাকা', divisionId: dhakaDivision.id },
  });

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
