import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Seeds the BranchType table.
 * Using upsert ensures the script is idempotent.
 */
export default async function seedBranchTypes(prisma: PrismaClient) {
  const items: Prisma.BranchTypeCreateInput[] = [
    { code: "CLINIC", nameEn: "Clinic", nameBn: "ক্লিনিক" },
    { code: "PET_SHOP", nameEn: "Pet Shop", nameBn: "পেট শপ" },
    { code: "SHOP", nameEn: "Shop / Retail (generic)", nameBn: "শপ" },
    { code: "DELIVERY_HUB", nameEn: "Delivery Hub (Logistics/Last-mile)", nameBn: "ডেলিভারি হাব" },
    { code: "DELIVERY", nameEn: "Delivery (alias)", nameBn: "ডেলিভারি" },
    { code: "HUB", nameEn: "Hub (alias)", nameBn: "হাব" },
    { code: "WAREHOUSE_DC", nameEn: "Warehouse / Distribution Center (Central Stock/Packaging)", nameBn: "ওয়্যারহাউস / ডিস্ট্রিবিউশন" },
    { code: "WAREHOUSE", nameEn: "Warehouse (alias)", nameBn: "ওয়্যারহাউস" },
    { code: "CENTRAL_WAREHOUSE", nameEn: "Central warehouse (alias)", nameBn: "সেন্ট্রাল ওয়্যারহাউস" },
    { code: "DISTRIBUTION_CENTER", nameEn: "Distribution center (alias)", nameBn: "ডিস্ট্রিবিউশন সেন্টার" },
    { code: "GROOMING_SPA", nameEn: "Pet Grooming & Spa", nameBn: "পেট গ্রুমিং ও স্পা" },
    { code: "BOARDING_DAYCARE", nameEn: "Pet Boarding / Daycare (Hotel/Hostel)", nameBn: "পেট বোর্ডিং / ডে কেয়ার" },
    { code: "FOSTER_SHELTER", nameEn: "Pet Foster Care / Shelter (Rescue + Adoption)", nameBn: "ফস্টার কেয়ার / শেল্টার" },
    { code: "TRAINING_BEHAVIOR", nameEn: "Training / Behavior Center", nameBn: "ট্রেনিং / বিহেভিয়ার সেন্টার" },
    { code: "PHARMACY_DIAGNOSTICS", nameEn: "Pharmacy / Diagnostics (Lab + Medicine)", nameBn: "ফার্মেসি / ডায়াগনস্টিক" },
    { code: "PHARMACY", nameEn: "Pharmacy (alias)", nameBn: "ফার্মেসি" },
  ];

  // Map the array to an array of promises
  const upsertPromises = items.map((it) =>
    prisma.branchType.upsert({
      where: { code: it.code },
      update: {
        nameEn: it.nameEn,
        nameBn: it.nameBn,
        isActive: true
      },
      create: {
        code: it.code,
        nameEn: it.nameEn,
        nameBn: it.nameBn,
        isActive: true
      },
    })
  );

  // Execute all upserts in parallel
  await Promise.all(upsertPromises);

  // eslint-disable-next-line no-console
  console.log(`✅ Seeded ${items.length} branch types`);
}
