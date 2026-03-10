/**
 * Clinic Catalog Install: preview and execute template install (copy master → org catalog).
 * Idempotent: by default skips categories/items already linked to same master; optional overwrite.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { getTemplateById } = require("./masterCatalog.service");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function generateItemCode(orgId: number, domainType: string): Promise<string> {
  const prefix = { MEDICINE: "MED", SURGICAL_CONSUMABLE: "CON", DRESSING_SUPPLY: "DRS", CLINIC_SUPPLY: "SUP", INSTRUMENT: "INS", IMPLANT: "IMP", SERVICE_SUPPORT: "SVC", PACKAGE_ONLY: "PKG" }[domainType] ?? "ITM";
  const pattern = `${prefix}-%`;
  const last = await prisma.clinicalItem.findFirst({
    where: { orgId, itemCode: { startsWith: prefix } },
    orderBy: { itemCode: "desc" },
    select: { itemCode: true },
  });
  let seq = 1;
  if (last?.itemCode) {
    const match = last.itemCode.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export interface PreviewInstallResult {
  templateId: number;
  templateName: string;
  templateVersion: string;
  categoriesToCreate: number;
  itemsToCreate: number;
  categoriesSkipped: number;
  itemsSkipped: number;
  categoryDetails: { masterCategoryId: number; name: string; slug: string; alreadyInstalled: boolean }[];
  itemDetails: { masterItemId: number; name: string; itemCode: string; slug: string; alreadyInstalled: boolean }[];
}

export async function previewInstall(
  orgId: number,
  templateId: number,
  options: { categoryIds?: number[]; itemIds?: number[] } = {}
): Promise<PreviewInstallResult> {
  const template = await getTemplateById(templateId);
  const rows = template.templateCategoryItems as Array<{
    masterCategoryId: number | null;
    masterItemId: number | null;
    includeSubcategories: boolean;
    masterCategory?: { id: number; name: string; slug: string } | null;
    masterItem?: { id: number; name: string; slug: string; itemCode: string; categoryId: number } | null;
  }>;

  const masterCategoryIds = new Set<number>();
  const masterItemIds = new Set<number>();
  for (const r of rows) {
    if (r.masterCategoryId && (options.categoryIds == null || options.categoryIds.includes(r.masterCategoryId))) {
      masterCategoryIds.add(r.masterCategoryId);
      if (r.includeSubcategories) {
        const children = await prisma.masterClinicalCatalogCategory.findMany({
          where: { parentId: r.masterCategoryId },
          select: { id: true },
        });
        children.forEach((c: { id: number }) => masterCategoryIds.add(c.id));
        const catItems = await prisma.masterClinicalCatalogItem.findMany({
          where: { categoryId: r.masterCategoryId },
          select: { id: true },
        });
        catItems.forEach((i: { id: number }) => masterItemIds.add(i.id));
      }
    }
    if (r.masterItemId && (options.itemIds == null || options.itemIds.includes(r.masterItemId))) {
      masterItemIds.add(r.masterItemId);
    }
  }

  const existingCategoryByMaster = await prisma.clinicalItemCategory.findMany({
    where: { orgId, masterCatalogCategoryId: { in: [...masterCategoryIds] } },
    select: { masterCatalogCategoryId: true },
  });
  const existingItemByMaster = await prisma.clinicalItem.findMany({
    where: { orgId, masterCatalogItemId: { in: [...masterItemIds] } },
    select: { masterCatalogItemId: true },
  });
  const existingCatSet = new Set(existingCategoryByMaster.map((c: { masterCatalogCategoryId: number | null }) => c.masterCatalogCategoryId).filter(Boolean));
  const existingItemSet = new Set(existingItemByMaster.map((i: { masterCatalogItemId: number | null }) => i.masterCatalogItemId).filter(Boolean));

  const categoryDetails: PreviewInstallResult["categoryDetails"] = [];
  for (const mid of masterCategoryIds) {
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
  const itemDetails: PreviewInstallResult["itemDetails"] = [];
  for (const mid of masterItemIds) {
    const master = await prisma.masterClinicalCatalogItem.findUnique({
      where: { id: mid },
      select: { id: true, name: true, itemCode: true, slug: true },
    });
    if (master) {
      itemDetails.push({
        masterItemId: master.id,
        name: master.name,
        itemCode: master.itemCode,
        slug: master.slug,
        alreadyInstalled: existingItemSet.has(mid),
      });
    }
  }

  return {
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version,
    categoriesToCreate: categoryDetails.filter((c) => !c.alreadyInstalled).length,
    itemsToCreate: itemDetails.filter((i) => !i.alreadyInstalled).length,
    categoriesSkipped: categoryDetails.filter((c) => c.alreadyInstalled).length,
    itemsSkipped: itemDetails.filter((i) => i.alreadyInstalled).length,
    categoryDetails,
    itemDetails,
  };
}

export interface InstallOptions {
  categoryIds?: number[];
  itemIds?: number[];
  overwriteExisting?: boolean;
}

export async function installTemplate(
  orgId: number,
  templateId: number,
  installedByUserId: number,
  options: InstallOptions = {}
): Promise<{ batchId: number; categoryCount: number; itemCount: number }> {
  const template = await getTemplateById(templateId);
  const preview = await previewInstall(orgId, templateId, options);

  const masterCategoryIds = preview.categoryDetails.filter((c) => !c.alreadyInstalled || options.overwriteExisting).map((c) => c.masterCategoryId);
  const masterItemIds = preview.itemDetails.filter((i) => !i.alreadyInstalled || options.overwriteExisting).map((i) => i.masterItemId);

  const slugToClinicCategoryId = new Map<string, number>();

  let categoryCount = 0;
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
      if (options.overwriteExisting) {
        await prisma.clinicalItemCategory.update({
          where: { id: existing.id },
          data: {
            name: master.name,
            domainType: master.domainType,
            sortOrder: master.sortOrder,
            description: master.description,
            isEssential: master.isEssential,
            inventoryTracked: master.inventoryTracked,
            packageEligible: master.packageEligible,
            prescriptionEligible: master.prescriptionEligible,
            supplyRequestable: master.supplyRequestable,
            procedureUsable: master.procedureUsable,
            branchVisible: master.branchVisible,
            pharmacyVisible: master.pharmacyVisible,
            otVisible: master.otVisible,
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
    categoryCount++;
  }

  let itemCount = 0;
  for (const masterItemId of masterItemIds) {
    const master = await prisma.masterClinicalCatalogItem.findUnique({
      where: { id: masterItemId },
      include: { category: true },
    });
    if (!master) continue;
    const clinicCategoryId = slugToClinicCategoryId.get((master.category as { slug: string }).slug) ?? null;
    const existing = await prisma.clinicalItem.findFirst({
      where: { orgId, masterCatalogItemId: masterItemId },
    });
    if (existing) {
      if (options.overwriteExisting) {
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
          },
        });
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
        createdByUserId: installedByUserId,
      },
    });
    itemCount++;
  }

  const batch = await prisma.clinicCatalogInstallBatch.create({
    data: {
      orgId,
      templateId,
      templateVersion: template.version,
      installedByUserId,
      status: "COMPLETED",
      categoryCount,
      itemCount,
      optionsJson: options as unknown as object,
    },
  });

  return { batchId: batch.id, categoryCount, itemCount };
}

export async function getInstallHistory(orgId: number, limit = 20) {
  const batches = await prisma.clinicCatalogInstallBatch.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      template: { select: { id: true, name: true, slug: true, version: true } },
      installedBy: { select: { id: true, email: true, name: true } },
    },
  });
  return batches;
}

export async function getUpgradeDiff(orgId: number, templateId: number) {
  const template = await getTemplateById(templateId);
  const lastBatch = await prisma.clinicCatalogInstallBatch.findFirst({
    where: { orgId, templateId },
    orderBy: { createdAt: "desc" },
    select: { templateVersion: true, createdAt: true },
  });
  const currentVersion = template.version;
  const installedVersion = lastBatch?.templateVersion ?? null;
  const hasUpdate = installedVersion != null && installedVersion !== currentVersion;
  return {
    templateId: template.id,
    templateName: template.name,
    currentVersion,
    installedVersion,
    hasUpdate,
    lastInstalledAt: lastBatch?.createdAt ?? null,
  };
}
