/**
 * Add from Master Catalog: preview and execute adding selected master items/categories to org clinic catalog.
 * Idempotent; supports createMissingOnly, createOrUpdate, skipExisting.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateItemCode(orgId: number, domainType: string): Promise<string> {
  const prefix: Record<string, string> = {
    MEDICINE: "MED",
    SURGICAL_CONSUMABLE: "CON",
    DRESSING_SUPPLY: "DRS",
    CLINIC_SUPPLY: "SUP",
    INSTRUMENT: "INS",
    IMPLANT: "IMP",
    SERVICE_SUPPORT: "SVC",
    PACKAGE_ONLY: "PKG",
  };
  const p = prefix[domainType] ?? "ITM";
  const last = await prisma.clinicalItem.findFirst({
    where: { orgId, itemCode: { startsWith: p } },
    orderBy: { itemCode: "desc" },
    select: { itemCode: true },
  });
  let seq = 1;
  if (last?.itemCode) {
    const match = last.itemCode.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${p}-${String(seq).padStart(4, "0")}`;
}

export type AddFromMasterOption = "createMissingOnly" | "createOrUpdate" | "skipExisting";

export interface PreviewAddFromMasterOptions {
  masterItemIds?: number[];
  masterCategoryIds?: number[];
  option?: AddFromMasterOption;
}

export interface PreviewAddFromMasterResult {
  selectedCount: number;
  newItemsCount: number;
  duplicateCount: number;
  newCategoriesCount: number;
  categoriesSkipped: number;
  categoryDetails: { masterCategoryId: number; name: string; slug: string; alreadyInstalled: boolean }[];
  itemDetails: { masterItemId: number; name: string; itemCode: string; slug: string; categoryName?: string; alreadyInstalled: boolean }[];
  actionSummary: string;
}

async function resolveMasterItemIds(
  masterItemIds: number[],
  masterCategoryIds: number[] | undefined
): Promise<Set<number>> {
  const set = new Set(masterItemIds);
  if (masterCategoryIds?.length) {
    const items = await prisma.masterClinicalCatalogItem.findMany({
      where: { categoryId: { in: masterCategoryIds } },
      select: { id: true },
    });
    items.forEach((i: { id: number }) => set.add(i.id));
  }
  return set;
}

export async function previewAddFromMaster(
  orgId: number,
  options: PreviewAddFromMasterOptions = {}
): Promise<PreviewAddFromMasterResult> {
  const masterItemIds = options.masterItemIds ?? [];
  const masterCategoryIds = options.masterCategoryIds ?? [];
  const allMasterItemIds = await resolveMasterItemIds(masterItemIds, masterCategoryIds.length ? masterCategoryIds : undefined);

  const masterCategoryIdsFromItems = new Set<number>();
  if (allMasterItemIds.size > 0) {
    const itemsWithCat = await prisma.masterClinicalCatalogItem.findMany({
      where: { id: { in: [...allMasterItemIds] } },
      select: { categoryId: true },
    });
    itemsWithCat.forEach((i: { categoryId: number }) => masterCategoryIdsFromItems.add(i.categoryId));
  }
  const allCategoryIds = new Set([...masterCategoryIds, ...masterCategoryIdsFromItems]);

  const existingCategories = await prisma.clinicalItemCategory.findMany({
    where: { orgId, masterCatalogCategoryId: { in: [...allCategoryIds] } },
    select: { masterCatalogCategoryId: true },
  });
  const existingItems = await prisma.clinicalItem.findMany({
    where: { orgId, masterCatalogItemId: { in: [...allMasterItemIds] } },
    select: { masterCatalogItemId: true },
  });
  const existingCatSet = new Set(
    existingCategories.map((c: { masterCatalogCategoryId: number | null }) => c.masterCatalogCategoryId).filter(Boolean)
  );
  const existingItemSet = new Set(
    existingItems.map((i: { masterCatalogItemId: number | null }) => i.masterCatalogItemId).filter(Boolean)
  );

  const categoryDetails: PreviewAddFromMasterResult["categoryDetails"] = [];
  for (const mid of allCategoryIds) {
    const master = await prisma.masterClinicalCatalogCategory.findUnique({
      where: { id: mid },
      select: { id: true, name: true, slug: true },
    });
    if (master) {
      categoryDetails.push({
        masterCategoryId: master.id,
        name: master.name,
        slug: master.slug,
        alreadyInstalled: existingCatSet.has(mid),
      });
    }
  }

  const itemDetails: PreviewAddFromMasterResult["itemDetails"] = [];
  for (const mid of allMasterItemIds) {
    const master = await prisma.masterClinicalCatalogItem.findUnique({
      where: { id: mid },
      include: { category: { select: { name: true } } },
    });
    if (master) {
      const alreadyInstalled = existingItemSet.has(mid);
      itemDetails.push({
        masterItemId: master.id,
        name: master.name,
        itemCode: master.itemCode,
        slug: master.slug,
        categoryName: (master.category as { name: string })?.name,
        alreadyInstalled,
      });
    }
  }

  const newItemsCount = itemDetails.filter((i) => !i.alreadyInstalled).length;
  const duplicateCount = itemDetails.filter((i) => i.alreadyInstalled).length;
  const newCategoriesCount = categoryDetails.filter((c) => !c.alreadyInstalled).length;
  const categoriesSkipped = categoryDetails.filter((c) => c.alreadyInstalled).length;
  const option = options.option ?? "createMissingOnly";
  const actionSummary =
    option === "createMissingOnly"
      ? `Create ${newItemsCount} new items, ${newCategoriesCount} new categories; skip ${duplicateCount} already installed.`
      : option === "createOrUpdate"
        ? `Create or update ${itemDetails.length} items, ensure ${categoryDetails.length} categories.`
        : `Skip ${duplicateCount} existing; create ${newItemsCount} new items.`;

  return {
    selectedCount: itemDetails.length,
    newItemsCount,
    duplicateCount,
    newCategoriesCount,
    categoriesSkipped,
    categoryDetails,
    itemDetails,
    actionSummary,
  };
}

export interface ExecuteAddFromMasterOptions {
  masterItemIds?: number[];
  masterCategoryIds?: number[];
  option?: AddFromMasterOption;
}

export interface ExecuteAddFromMasterResult {
  createdCategories: number;
  createdItems: number;
  updatedItems: number;
  skippedItems: number;
}

export async function executeAddFromMaster(
  orgId: number,
  userId: number,
  options: ExecuteAddFromMasterOptions = {}
): Promise<ExecuteAddFromMasterResult> {
  const preview = await previewAddFromMaster(orgId, {
    masterItemIds: options.masterItemIds,
    masterCategoryIds: options.masterCategoryIds,
    option: options.option,
  });
  const option = options.option ?? "createMissingOnly";
  const overwriteExisting = option === "createOrUpdate";

  const masterCategoryIds = preview.categoryDetails
    .filter((c) => !c.alreadyInstalled || overwriteExisting)
    .map((c) => c.masterCategoryId);
  const masterItemIdsToProcess = preview.itemDetails
    .filter((i) => !i.alreadyInstalled || overwriteExisting)
    .map((i) => i.masterItemId);

  const slugToClinicCategoryId = new Map<string, number>();

  let createdCategories = 0;
  for (const masterCategoryId of masterCategoryIds) {
    const master = await prisma.masterClinicalCatalogCategory.findUnique({
      where: { id: masterCategoryId },
      include: { parent: true },
    });
    if (!master) continue;
    const parentClinicId = master.parentId
      ? slugToClinicCategoryId.get((master.parent as { slug: string }).slug)
      : null;
    const existing = await prisma.clinicalItemCategory.findFirst({
      where: { orgId, masterCatalogCategoryId: masterCategoryId },
    });
    if (existing) {
      if (overwriteExisting) {
        await prisma.clinicalItemCategory.update({
          where: { id: existing.id },
          data: {
            name: master.name,
            domainType: master.domainType,
            sortOrder: master.sortOrder,
            description: master.description,
            isEssential: master.isEssential,
            inventoryTracked: master.inventoryTracked ?? true,
            packageEligible: master.packageEligible ?? true,
            prescriptionEligible: master.prescriptionEligible ?? false,
            supplyRequestable: master.supplyRequestable ?? true,
            procedureUsable: master.procedureUsable ?? true,
            branchVisible: master.branchVisible ?? true,
            pharmacyVisible: master.pharmacyVisible ?? true,
            otVisible: master.otVisible ?? true,
          },
        });
      }
      slugToClinicCategoryId.set(master.slug, existing.id);
      continue;
    }
    const created = await prisma.clinicalItemCategory.create({
      data: {
        orgId,
        name: master.name,
        parentId: parentClinicId ?? undefined,
        domainType: master.domainType ?? undefined,
        sortOrder: master.sortOrder,
        description: master.description ?? undefined,
        isEssential: master.isEssential,
        inventoryTracked: master.inventoryTracked ?? true,
        packageEligible: master.packageEligible ?? true,
        prescriptionEligible: master.prescriptionEligible ?? false,
        supplyRequestable: master.supplyRequestable ?? true,
        procedureUsable: master.procedureUsable ?? true,
        branchVisible: master.branchVisible ?? true,
        pharmacyVisible: master.pharmacyVisible ?? true,
        otVisible: master.otVisible ?? true,
        masterCatalogCategoryId: master.id,
      },
    });
    slugToClinicCategoryId.set(master.slug, created.id);
    createdCategories++;
  }

  let createdItems = 0;
  let updatedItems = 0;
  let skippedItems = 0;
  for (const masterItemId of masterItemIdsToProcess) {
    const master = await prisma.masterClinicalCatalogItem.findUnique({
      where: { id: masterItemId },
      include: { category: true },
    });
    if (!master) continue;
    const masterCat = master.category as { slug: string };
    const clinicCategoryId = slugToClinicCategoryId.get(masterCat.slug) ?? null;
    const existing = await prisma.clinicalItem.findFirst({
      where: { orgId, masterCatalogItemId: masterItemId },
    });
    if (existing) {
      if (overwriteExisting) {
        await prisma.clinicalItem.update({
          where: { id: existing.id },
          data: {
            name: master.name,
            domainType: master.domainType,
            baseUnit: master.baseUnit ?? undefined,
            description: master.description ?? undefined,
            isPackageEligible: master.isPackageEligible,
            isInventoryTracked: master.isInventoryTracked,
            requiresBatch: master.requiresBatch,
            requiresExpiry: master.requiresExpiry,
            isReusable: master.isReusable,
            categoryId: clinicCategoryId,
            updatedByUserId: userId,
          },
        });
        updatedItems++;
      } else {
        skippedItems++;
      }
      continue;
    }
    let itemCode = master.itemCode;
    const codeExists = await prisma.clinicalItem.findFirst({
      where: { orgId, itemCode },
      select: { id: true },
    });
    if (codeExists) itemCode = await generateItemCode(orgId, master.domainType);
    const slugBase = slugify(master.name);
    let slug = slugBase;
    let slugIdx = 0;
    while (await prisma.clinicalItem.findFirst({ where: { orgId, slug }, select: { id: true } })) {
      slug = `${slugBase}-${++slugIdx}`;
    }
    await prisma.clinicalItem.create({
      data: {
        orgId,
        itemCode,
        name: master.name,
        slug,
        domainType: master.domainType,
        categoryId: clinicCategoryId ?? undefined,
        baseUnit: master.baseUnit ?? undefined,
        description: master.description ?? undefined,
        isPackageEligible: master.isPackageEligible,
        isInventoryTracked: master.isInventoryTracked,
        requiresBatch: master.requiresBatch,
        requiresExpiry: master.requiresExpiry,
        isReusable: master.isReusable,
        masterCatalogItemId: master.id,
        createdByUserId: userId,
      },
    });
    createdItems++;
  }

  return {
    createdCategories,
    createdItems,
    updatedItems,
    skippedItems,
  };
}
