import { ClinicalItemDomain, PrismaClient } from "@prisma/client";
import { DEFAULT_CLINICAL_VACCINE_ITEMS } from "./data/defaultClinicalVaccineItems";

type SeedResult = {
  orgId: number;
  createdCategory: boolean;
  createdItems: string[];
  updatedItems: string[];
  aliasMatchedItems: Array<{ targetName: string; existingName: string; itemCode: string }>;
  skippedItems: string[];
};

async function ensureVaccinesCategory(prisma: PrismaClient, orgId: number) {
  const existing = await prisma.clinicalItemCategory.findFirst({
    where: {
      orgId,
      name: "Vaccines",
      domainType: ClinicalItemDomain.MEDICINE,
    },
    orderBy: { id: "asc" },
  });
  if (existing) return { category: existing, created: false };

  const masterCategory = await prisma.masterClinicalCatalogCategory.findUnique({
    where: { slug: "vaccines" },
    select: { id: true },
  });

  const created = await prisma.clinicalItemCategory.create({
    data: {
      orgId,
      name: "Vaccines",
      parentId: null,
      domainType: ClinicalItemDomain.MEDICINE,
      sortOrder: 3,
      description: "Vaccination and immunization inventory items.",
      isEssential: true,
      inventoryTracked: true,
      packageEligible: true,
      prescriptionEligible: false,
      supplyRequestable: true,
      procedureUsable: true,
      branchVisible: true,
      pharmacyVisible: true,
      otVisible: false,
      masterCatalogCategoryId: masterCategory?.id ?? null,
    },
  });

  return { category: created, created: true };
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export default async function seedClinicalVaccineItems(
  prisma: PrismaClient,
  opts: { orgId?: number | null } = {}
): Promise<SeedResult[]> {
  const orgs = opts.orgId
    ? await prisma.organization.findMany({
        where: { id: Number(opts.orgId) },
        select: { id: true },
      })
    : await prisma.organization.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      });

  const results: SeedResult[] = [];

  for (const org of orgs) {
    const { category, created } = await ensureVaccinesCategory(prisma, org.id);
    const result: SeedResult = {
      orgId: org.id,
      createdCategory: created,
      createdItems: [],
      updatedItems: [],
      aliasMatchedItems: [],
      skippedItems: [],
    };

    for (const item of DEFAULT_CLINICAL_VACCINE_ITEMS) {
      const exactByCode = await prisma.clinicalItem.findUnique({
        where: { orgId_itemCode: { orgId: org.id, itemCode: item.itemCode } },
        select: { id: true, itemCode: true, name: true },
      });

      if (exactByCode) {
        await prisma.clinicalItem.update({
          where: { id: exactByCode.id },
          data: {
            name: item.name,
            slug: item.slug,
            categoryId: category.id,
            domainType: ClinicalItemDomain.MEDICINE,
            isActive: true,
            isClinicUse: true,
            isSellable: false,
            isPackageEligible: true,
            isInventoryTracked: true,
            requiresBatch: true,
            requiresExpiry: true,
            isReusable: false,
            description: item.description,
            baseUnit: "dose",
          },
        });
        result.updatedItems.push(`${item.itemCode} ${exactByCode.name}`);
        continue;
      }

      const acceptableNames = [item.name, ...(item.aliasNames ?? [])];
      const nameMatches = await prisma.clinicalItem.findMany({
        where: {
          orgId: org.id,
          domainType: ClinicalItemDomain.MEDICINE,
          OR: acceptableNames.map((name) => ({ name })),
        },
        select: { id: true, itemCode: true, name: true },
        orderBy: { id: "asc" },
      });

      const normalizedToTarget = new Set(acceptableNames.map((name) => normalizeName(name)));
      const aliasMatch =
        nameMatches.find((match) => normalizeName(match.name) === normalizeName(item.name)) ??
        nameMatches.find((match) => normalizedToTarget.has(normalizeName(match.name)));

      if (aliasMatch) {
        result.aliasMatchedItems.push({
          targetName: item.name,
          existingName: aliasMatch.name,
          itemCode: aliasMatch.itemCode,
        });
        continue;
      }

      const masterCatalogItem = await prisma.masterClinicalCatalogItem.findFirst({
        where: {
          OR: [{ itemCode: item.itemCode }, { slug: item.slug }],
        },
        select: { id: true },
      });

      await prisma.clinicalItem.create({
        data: {
          orgId: org.id,
          itemCode: item.itemCode,
          name: item.name,
          slug: item.slug,
          domainType: ClinicalItemDomain.MEDICINE,
          categoryId: category.id,
          baseUnit: "dose",
          description: item.description,
          isActive: true,
          isClinicUse: true,
          isSellable: false,
          isPackageEligible: true,
          isInventoryTracked: true,
          requiresBatch: true,
          requiresExpiry: true,
          isReusable: false,
          masterCatalogItemId: masterCatalogItem?.id ?? null,
        },
      });

      result.createdItems.push(`${item.itemCode} ${item.name}`);
    }

    results.push(result);
  }

  return results;
}
