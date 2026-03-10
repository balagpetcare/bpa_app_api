/**
 * Seeds the global Clinic Master Catalog: categories, items, templates and template mappings.
 * Idempotent: uses slug/code for upsert. Run after seedClinicalItemCategories if org-level defaults are needed.
 */
import { PrismaClient } from "@prisma/client";
import { MASTER_CLINICAL_CATALOG_CATEGORIES } from "./data/masterClinicalCatalogCategories";
import { MASTER_CLINICAL_CATALOG_ITEMS } from "./data/masterClinicalCatalogItems";
import { MASTER_CLINICAL_CATALOG_TEMPLATES } from "./data/masterClinicalCatalogTemplates";

export default async function seedMasterClinicalCatalog(prisma: PrismaClient) {
  console.log("🌱 Seeding Master Clinical Catalog (categories, items, templates)...");

  const slugToCategoryId = new Map<string, number>();
  // Pre-populate from DB so templates can reference categories created by CSV seed (e.g. medicines, injectables)
  const existingCategories = await prisma.masterClinicalCatalogCategory.findMany({ select: { id: true, slug: true } });
  existingCategories.forEach((c) => slugToCategoryId.set(c.slug, c.id));

  // 1) Master categories (parentSlug resolved in second pass)
  const categoriesWithoutParent = MASTER_CLINICAL_CATALOG_CATEGORIES.filter((c) => !c.parentSlug);
  const categoriesWithParent = MASTER_CLINICAL_CATALOG_CATEGORIES.filter((c) => c.parentSlug);

  for (const c of categoriesWithoutParent) {
    const existing = await prisma.masterClinicalCatalogCategory.findUnique({ where: { slug: c.slug } });
    if (existing) {
      slugToCategoryId.set(c.slug, existing.id);
      continue;
    }
    const created = await prisma.masterClinicalCatalogCategory.create({
      data: {
        name: c.name,
        slug: c.slug,
        parentId: null,
        domainType: c.domainType,
        sortOrder: c.sortOrder,
        description: c.description ?? null,
        isEssential: c.isEssential,
        inventoryTracked: c.inventoryTracked,
        packageEligible: c.packageEligible,
        prescriptionEligible: c.prescriptionEligible,
        supplyRequestable: c.supplyRequestable,
        procedureUsable: c.procedureUsable,
        branchVisible: c.branchVisible,
        pharmacyVisible: c.pharmacyVisible,
        otVisible: c.otVisible,
        isActive: true,
      },
    });
    slugToCategoryId.set(c.slug, created.id);
  }

  for (const c of categoriesWithParent) {
    const parentId = c.parentSlug ? slugToCategoryId.get(c.parentSlug) ?? null : null;
    const existing = await prisma.masterClinicalCatalogCategory.findUnique({ where: { slug: c.slug } });
    if (existing) {
      slugToCategoryId.set(c.slug, existing.id);
      continue;
    }
    const created = await prisma.masterClinicalCatalogCategory.create({
      data: {
        name: c.name,
        slug: c.slug,
        parentId,
        domainType: c.domainType,
        sortOrder: c.sortOrder,
        description: c.description ?? null,
        isEssential: c.isEssential,
        inventoryTracked: c.inventoryTracked,
        packageEligible: c.packageEligible,
        prescriptionEligible: c.prescriptionEligible,
        supplyRequestable: c.supplyRequestable,
        procedureUsable: c.procedureUsable,
        branchVisible: c.branchVisible,
        pharmacyVisible: c.pharmacyVisible,
        otVisible: c.otVisible,
        isActive: true,
      },
    });
    slugToCategoryId.set(c.slug, created.id);
  }

  // 2) Master items
  const slugToItemId = new Map<string, number>();
  for (const it of MASTER_CLINICAL_CATALOG_ITEMS) {
    const categoryId = slugToCategoryId.get(it.categorySlug);
    if (!categoryId) {
      console.warn(`   Skip item ${it.slug}: category ${it.categorySlug} not found`);
      continue;
    }
    const existing = await prisma.masterClinicalCatalogItem.findFirst({
      where: { categoryId, slug: it.slug },
    });
    if (existing) {
      slugToItemId.set(it.slug, existing.id);
      continue;
    }
    const created = await prisma.masterClinicalCatalogItem.create({
      data: {
        categoryId,
        itemCode: it.itemCode,
        name: it.name,
        slug: it.slug,
        domainType: it.domainType,
        baseUnit: it.baseUnit ?? null,
        description: it.description ?? null,
        isActive: true,
        isPackageEligible: it.isPackageEligible,
        isInventoryTracked: it.isInventoryTracked,
        requiresBatch: it.requiresBatch,
        requiresExpiry: it.requiresExpiry,
        isReusable: it.isReusable,
        defaultReorderLevel: it.defaultReorderLevel ?? null,
        defaultMinStock: it.defaultMinStock ?? null,
        defaultMaxStock: it.defaultMaxStock ?? null,
        coldChainRequired: it.coldChainRequired,
        controlledItem: it.controlledItem,
        usageNoteTemplate: it.usageNoteTemplate ?? null,
      },
    });
    slugToItemId.set(it.slug, created.id);
  }

  // 3) Templates and template_category_items
  for (let tIdx = 0; tIdx < MASTER_CLINICAL_CATALOG_TEMPLATES.length; tIdx++) {
    const t = MASTER_CLINICAL_CATALOG_TEMPLATES[tIdx];
    let template = await prisma.masterClinicalCatalogTemplate.findUnique({ where: { slug: t.slug } });
    if (!template) {
      template = await prisma.masterClinicalCatalogTemplate.create({
        data: {
          name: t.name,
          slug: t.slug,
          description: t.description,
          version: t.version,
          isActive: true,
        },
      });
    }

    const existingMappings = await prisma.templateCategoryItem.findMany({
      where: { templateId: template.id },
      select: { id: true, masterCategoryId: true, masterItemId: true },
    });
    if (existingMappings.length > 0) {
      continue; // already seeded this template
    }

    let sortOrder = 0;
    for (const catSlug of t.categorySlugs) {
      const masterCategoryId = slugToCategoryId.get(catSlug);
      if (!masterCategoryId) continue;
      await prisma.templateCategoryItem.create({
        data: {
          templateId: template.id,
          masterCategoryId,
          masterItemId: null,
          sortOrder: sortOrder++,
          includeSubcategories: true,
        },
      });
    }
    for (const itemSlug of t.itemSlugs) {
      const masterItemId = slugToItemId.get(itemSlug);
      if (!masterItemId) continue;
      await prisma.templateCategoryItem.create({
        data: {
          templateId: template.id,
          masterCategoryId: null,
          masterItemId,
          sortOrder: sortOrder++,
          includeSubcategories: false,
        },
      });
    }
  }

  const catCount = await prisma.masterClinicalCatalogCategory.count();
  const itemCount = await prisma.masterClinicalCatalogItem.count();
  const templateCount = await prisma.masterClinicalCatalogTemplate.count();
  console.log(`   Master Clinical Catalog: ${catCount} categories, ${itemCount} items, ${templateCount} templates.`);
}
