import { PrismaClient } from '@prisma/client';

const DEFAULT_ORG_TYPES = [
  { code: 'CLINIC_ORG', nameEn: 'Clinic Organization', nameBn: 'ক্লিনিক প্রতিষ্ঠান', sortOrder: 10 },
  { code: 'PET_SHOP_ORG', nameEn: 'Pet Shop Organization', nameBn: 'পেট শপ প্রতিষ্ঠান', sortOrder: 20 },
  { code: 'DELIVERY_ORG', nameEn: 'Delivery Hub Organization', nameBn: 'ডেলিভারি হাব প্রতিষ্ঠান', sortOrder: 30 },
  { code: 'NGO', nameEn: 'NGO / Shelter', nameBn: 'এনজিও / শেল্টার', sortOrder: 40 },
  { code: 'BREEDER', nameEn: 'Breeder', nameBn: 'ব্রিডার', sortOrder: 50 },
  { code: 'TRAINING_CENTER', nameEn: 'Training Center', nameBn: 'ট্রেনিং সেন্টার', sortOrder: 60 },
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
