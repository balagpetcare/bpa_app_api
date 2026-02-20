import { PrismaClient } from '@prisma/client';

const DEFAULT_ORG_TYPES = [
  // BUSINESS (Profit)
  {
    code: 'VET_CLINIC',
    nameEn: 'Veterinary Clinic',
    nameBn: 'ভেটেরিনারি ক্লিনিক',
    sortOrder: 10,
  },
  {
    code: 'PET_SHOP',
    nameEn: 'Pet Shop',
    nameBn: 'পেট শপ',
    sortOrder: 20,
  },
  {
    code: 'FOSTER_CARE',
    nameEn: 'Foster Care Service',
    nameBn: 'ফস্টার কেয়ার সার্ভিস',
    sortOrder: 30,
  },
  {
    code: 'PET_TRAINING',
    nameEn: 'Pet Training Center',
    nameBn: 'পেট ট্রেনিং সেন্টার',
    sortOrder: 40,
  },

  // NON-PROFIT / WELFARE
  {
    code: 'SHELTER_HOME',
    nameEn: 'Animal Shelter Home',
    nameBn: 'এনিমেল শেল্টার হোম',
    sortOrder: 50,
  },
  {
    code: 'ANIMAL_WELFARE_ORG',
    nameEn: 'Animal Welfare Organization',
    nameBn: 'প্রাণী কল্যাণ সংস্থা',
    sortOrder: 60,
  },
];


export default async function seedOrganizationTypes(prisma: PrismaClient) {
  // If migration not applied yet, Prisma will throw. We keep seed resilient.
  try {
    for (const it of DEFAULT_ORG_TYPES) {
      await prisma.organizationType.upsert({
        where: { code: it.code },
        update: {
          nameEn: it.nameEn,
          nameBn: it.nameBn,
          isActive: true,
          sortOrder: it.sortOrder,
        },
        create: {
          code: it.code,
          nameEn: it.nameEn,
          nameBn: it.nameBn,
          isActive: true,
          sortOrder: it.sortOrder,
        },
      });
    }
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ seedOrganizationTypes skipped (table not found yet):', e?.message || e);
  }
}
