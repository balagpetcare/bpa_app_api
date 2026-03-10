import { PrismaClient, ClinicalItemDomain } from "@prisma/client";

/**
 * Seeds default clinical item categories per organization.
 * For each org that has no clinical item categories, creates:
 * - Medicines > Injectables, Antibiotics, Pain
 * - Surgical Consumables > Sutures, Blades, Gauze
 * - Instruments > Scissors, Forceps
 * - OT Supplies > Disposables
 */
export default async function seedClinicalItemCategories(prisma: PrismaClient) {
  console.log("🌱 Seeding default clinical item categories...");

  const orgs = await prisma.organization.findMany({
    select: { id: true },
    where: {
      clinicalItemCategories: { none: {} },
    },
  });

  for (const org of orgs) {
    const sort = (i: number) => i;

    // Medicines (parent)
    const medicines = await prisma.clinicalItemCategory.create({
      data: {
        orgId: org.id,
        name: "Medicines",
        parentId: null,
        domainType: ClinicalItemDomain.MEDICINE,
        sortOrder: sort(0),
      },
    });
    await prisma.clinicalItemCategory.createMany({
      data: [
        { orgId: org.id, parentId: medicines.id, name: "Injectables", domainType: ClinicalItemDomain.MEDICINE, sortOrder: sort(0) },
        { orgId: org.id, parentId: medicines.id, name: "Antibiotics", domainType: ClinicalItemDomain.MEDICINE, sortOrder: sort(1) },
        { orgId: org.id, parentId: medicines.id, name: "Pain", domainType: ClinicalItemDomain.MEDICINE, sortOrder: sort(2) },
      ],
    });

    // Surgical Consumables (parent)
    const surgical = await prisma.clinicalItemCategory.create({
      data: {
        orgId: org.id,
        name: "Surgical Consumables",
        parentId: null,
        domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE,
        sortOrder: sort(1),
      },
    });
    await prisma.clinicalItemCategory.createMany({
      data: [
        { orgId: org.id, parentId: surgical.id, name: "Sutures", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, sortOrder: sort(0) },
        { orgId: org.id, parentId: surgical.id, name: "Blades", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, sortOrder: sort(1) },
        { orgId: org.id, parentId: surgical.id, name: "Gauze", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, sortOrder: sort(2) },
      ],
    });

    // Instruments (parent)
    const instruments = await prisma.clinicalItemCategory.create({
      data: {
        orgId: org.id,
        name: "Instruments",
        parentId: null,
        domainType: ClinicalItemDomain.INSTRUMENT,
        sortOrder: sort(2),
      },
    });
    await prisma.clinicalItemCategory.createMany({
      data: [
        { orgId: org.id, parentId: instruments.id, name: "Scissors", domainType: ClinicalItemDomain.INSTRUMENT, sortOrder: sort(0) },
        { orgId: org.id, parentId: instruments.id, name: "Forceps", domainType: ClinicalItemDomain.INSTRUMENT, sortOrder: sort(1) },
      ],
    });

    // OT Supplies (parent)
    const otSupplies = await prisma.clinicalItemCategory.create({
      data: {
        orgId: org.id,
        name: "OT Supplies",
        parentId: null,
        domainType: ClinicalItemDomain.CLINIC_SUPPLY,
        sortOrder: sort(3),
      },
    });
    await prisma.clinicalItemCategory.create({
      data: {
        orgId: org.id,
        parentId: otSupplies.id,
        name: "Disposables",
        domainType: ClinicalItemDomain.CLINIC_SUPPLY,
        sortOrder: sort(0),
      },
    });
  }

  console.log(`   Created default categories for ${orgs.length} organization(s).`);
}
