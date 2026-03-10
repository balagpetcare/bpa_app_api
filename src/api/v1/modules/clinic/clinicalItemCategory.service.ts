/**
 * Clinical Item Category: hierarchical category tree for clinical items.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

/** List categories (flat or by parent) */
export async function listClinicalItemCategories(options: {
  orgId: number;
  parentId?: number | null;
  domainType?: string;
  isActive?: boolean;
}) {
  const where: Record<string, unknown> = { orgId: options.orgId };
  if (options.parentId !== undefined) where.parentId = options.parentId;
  if (options.domainType != null) where.domainType = options.domainType;
  if (options.isActive != null) where.isActive = options.isActive;

  const categories = await prisma.clinicalItemCategory.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { items: true, children: true } },
    },
  });
  return categories;
}

/** Get category tree (nested) for org */
export async function getClinicalItemCategoryTree(orgId: number) {
  const all = await prisma.clinicalItemCategory.findMany({
    where: { orgId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  function buildTree(parentId: number | null): typeof all {
    return all
      .filter((c) => c.parentId === parentId)
      .map((c) => ({
        ...c,
        children: buildTree(c.id),
      }));
  }
  return buildTree(null);
}

/** Get one category by id */
export async function getClinicalItemCategoryById(
  categoryId: number,
  orgId: number
) {
  const cat = await prisma.clinicalItemCategory.findFirst({
    where: { id: categoryId, orgId },
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { items: true, children: true } },
    },
  });
  if (!cat) throw new Error("Clinical item category not found");
  return cat;
}

/** Create category */
export async function createClinicalItemCategory(data: {
  orgId: number;
  name: string;
  parentId?: number | null;
  domainType?: string | null;
  sortOrder?: number;
}) {
  const category = await prisma.clinicalItemCategory.create({
    data: {
      orgId: data.orgId,
      name: data.name.trim(),
      parentId: data.parentId ?? undefined,
      domainType: data.domainType ?? undefined,
      sortOrder: data.sortOrder ?? 0,
    },
  });
  return category;
}

/** Update category */
export async function updateClinicalItemCategory(
  categoryId: number,
  orgId: number,
  data: {
    name?: string;
    parentId?: number | null;
    domainType?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  }
) {
  const existing = await prisma.clinicalItemCategory.findFirst({
    where: { id: categoryId, orgId },
    select: { id: true },
  });
  if (!existing) throw new Error("Clinical item category not found");

  const updateData: Record<string, unknown> = {};
  if (data.name != null) updateData.name = data.name.trim();
  if (data.parentId !== undefined) updateData.parentId = data.parentId;
  if (data.domainType !== undefined) updateData.domainType = data.domainType;
  if (data.sortOrder != null) updateData.sortOrder = data.sortOrder;
  if (data.isActive != null) updateData.isActive = data.isActive;

  return prisma.clinicalItemCategory.update({
    where: { id: categoryId },
    data: updateData,
  });
}

/** Delete category (only if no items and no children) */
export async function deleteClinicalItemCategory(
  categoryId: number,
  orgId: number
) {
  const cat = await prisma.clinicalItemCategory.findFirst({
    where: { id: categoryId, orgId },
    include: { _count: { select: { items: true, children: true } } },
  });
  if (!cat) throw new Error("Clinical item category not found");
  if ((cat as { _count?: { items: number; children: number } })._count?.items > 0) {
    throw new Error("Category has items; reassign or remove them first");
  }
  if ((cat as { _count?: { items: number; children: number } })._count?.children > 0) {
    throw new Error("Category has subcategories; remove them first");
  }
  await prisma.clinicalItemCategory.delete({
    where: { id: categoryId },
  });
  return { ok: true };
}
