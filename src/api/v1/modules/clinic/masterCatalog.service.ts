/**
 * Master Clinical Catalog: list global categories, items, templates (read-only for install flow).
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

export interface ListMasterCategoriesOptions {
  parentId?: number | null;
  domainType?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export async function listMasterCategories(options: ListMasterCategoriesOptions = {}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 100, 200);
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (options.parentId !== undefined) where.parentId = options.parentId;
  if (options.domainType != null) where.domainType = options.domainType;
  if (options.isActive != null) where.isActive = options.isActive;

  const [items, total] = await Promise.all([
    prisma.masterClinicalCatalogCategory.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true, children: true } } },
    }),
    prisma.masterClinicalCatalogCategory.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getMasterCategoryTree() {
  const all = await prisma.masterClinicalCatalogCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  function buildTree(parentId: number | null): typeof all {
    return all
      .filter((c: { parentId: number | null }) => c.parentId === parentId)
      .map((c: { id: number; parentId: number | null; [k: string]: unknown }) => ({
        ...c,
        children: buildTree(c.id),
      }));
  }
  return buildTree(null);
}

export interface ListMasterItemsOptions {
  categoryId?: number;
  domainType?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export async function listMasterItems(options: ListMasterItemsOptions = {}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 100, 200);
  const skip = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (options.categoryId != null) where.categoryId = options.categoryId;
  if (options.domainType != null) where.domainType = options.domainType;
  if (options.isActive != null) where.isActive = options.isActive;
  if (options.search && options.search.trim()) {
    const q = options.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { itemCode: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.masterClinicalCatalogItem.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ categoryId: "asc" }, { itemCode: "asc" }],
      include: { category: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.masterClinicalCatalogItem.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listTemplates(options: { isActive?: boolean } = {}) {
  const where: Record<string, unknown> = {};
  if (options.isActive != null) where.isActive = options.isActive;
  const templates = await prisma.masterClinicalCatalogTemplate.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      _count: { select: { templateCategoryItems: true } },
    },
  });
  return templates;
}

export async function getTemplateById(templateId: number) {
  const template = await prisma.masterClinicalCatalogTemplate.findUnique({
    where: { id: templateId },
    include: {
      templateCategoryItems: {
        orderBy: { sortOrder: "asc" },
        include: {
          masterCategory: { select: { id: true, name: true, slug: true } },
          masterItem: { select: { id: true, name: true, slug: true, itemCode: true, categoryId: true } },
        },
      },
    },
  });
  if (!template) throw new Error("Template not found");
  return template;
}

export async function getMasterCategoryById(id: number) {
  const cat = await prisma.masterClinicalCatalogCategory.findUnique({
    where: { id },
    include: { _count: { select: { items: true, children: true } } },
  });
  if (!cat) throw new Error("Master category not found");
  return cat;
}

export async function getMasterItemById(id: number) {
  const item = await prisma.masterClinicalCatalogItem.findUnique({
    where: { id },
    include: { category: true },
  });
  if (!item) throw new Error("Master item not found");
  return item;
}
