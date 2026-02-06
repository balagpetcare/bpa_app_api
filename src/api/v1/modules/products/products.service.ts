const prisma = require("../../../../infrastructure/db/prismaClient");
const { slugify } = require("../../../../utils/helpers");

/** Resolve orgId for user: OrgMember (ACTIVE) or Organization.ownerUserId (owner). */
async function getOrgIdForUser(userId) {
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  if (member?.orgId) return member.orgId;
  const owned = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  return owned?.id ?? null;
}

/**
 * Get products with pagination and filters
 */
async function getProducts(options: {
  orgId?: number;
  branchId?: number;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (options.orgId) {
    where.orgId = options.orgId;
  }

  if (options.status) {
    where.status = options.status;
  }

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: "insensitive" } },
      { slug: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      include: {
        org: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        variants: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single product by ID
 */
async function getProductById(productId: number, orgId?: number) {
  const where: any = { id: productId };
  if (orgId) {
    where.orgId = orgId;
  }

  const product = await prisma.product.findFirst({
    where,
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
      category: true,
      brand: true,
      createdBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      variants: {
        orderBy: { createdAt: "asc" },
      },
      media: {
        orderBy: { sortOrder: "asc" },
        include: {
          media: { select: { id: true, url: true, type: true } },
        },
      },
    },
  });

  if (!product) {
    throw new Error("Product not found");
  }

  return product;
}

/**
 * Create new product
 */
async function createProduct(data: {
  orgId: number;
  name: string;
  slug?: string;
  status?: string;
  categoryId?: number | null;
  brandId?: number | null;
  description?: string | null;
  createdByUserId: number;
  variants?: Array<{
    sku: string;
    title: string;
    attributes?: any;
  }>;
}) {
  const baseSlug = (data.slug && data.slug.trim()) ? slugify(data.slug) : slugify(data.name);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.product.findFirst({
      where: {
        orgId: data.orgId,
        slug: slug,
      },
    });

    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const product = await prisma.product.create({
    data: {
      orgId: data.orgId,
      name: data.name,
      slug: slug,
      status: data.status || "ACTIVE",
      categoryId: data.categoryId ?? undefined,
      brandId: data.brandId ?? undefined,
      description: data.description ?? undefined,
      createdByUserId: data.createdByUserId,
      variants: data.variants
        ? {
            create: data.variants.map((v) => ({
              sku: v.sku,
              title: v.title,
              attributes: v.attributes || {},
              isActive: true,
            })),
          }
        : undefined,
    },
    include: {
      org: true,
      category: true,
      brand: true,
      variants: true,
    },
  });

  return product;
}

/**
 * Update product
 */
async function updateProduct(
  productId: number,
  data: {
    name?: string;
    slug?: string;
    status?: string;
    categoryId?: number | null;
    brandId?: number | null;
    description?: string | null;
    orgId?: number;
  },
  orgId?: number
) {
  const where: any = { id: productId };
  if (orgId) {
    where.orgId = orgId;
  }

  const existing = await prisma.product.findFirst({ where });
  if (!existing) {
    throw new Error("Product not found");
  }

  const updateData: any = {};

  if (data.name !== undefined && data.name !== existing.name) {
    updateData.name = data.name.trim();
    const baseSlug = (data.slug && data.slug.trim()) ? slugify(data.slug) : slugify(data.name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existingSlug = await prisma.product.findFirst({
        where: {
          orgId: existing.orgId,
          slug: slug,
          id: { not: productId },
        },
      });

      if (!existingSlug) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    updateData.slug = slug;
  } else if (data.slug !== undefined && data.slug.trim()) {
    const baseSlug = slugify(data.slug);
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const existingSlug = await prisma.product.findFirst({
        where: {
          orgId: existing.orgId,
          slug: slug,
          id: { not: productId },
        },
      });
      if (!existingSlug) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    updateData.slug = slug;
  }

  if (data.status !== undefined) updateData.status = data.status;
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
  if (data.brandId !== undefined) updateData.brandId = data.brandId;
  if (data.description !== undefined) updateData.description = data.description;

  const product = await prisma.product.update({
    where: { id: productId },
    data: updateData,
    include: {
      org: true,
      category: true,
      brand: true,
      variants: true,
    },
  });

  return product;
}

/**
 * Delete product (soft delete by setting status to INACTIVE)
 */
async function deleteProduct(productId: number, orgId?: number) {
  const where: any = { id: productId };
  if (orgId) {
    where.orgId = orgId;
  }

  const existing = await prisma.product.findFirst({ where });
  if (!existing) {
    throw new Error("Product not found");
  }

  // Soft delete: set status to INACTIVE
  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "INACTIVE" },
  });

  return product;
}

/**
 * Add variant to product
 */
async function addVariant(
  productId: number,
  data: {
    sku: string;
    title: string;
    attributes?: any;
  },
  orgId?: number
) {
  // Verify product exists and belongs to org
  const where: any = { id: productId };
  if (orgId) {
    where.orgId = orgId;
  }

  const product = await prisma.product.findFirst({ where });
  if (!product) {
    throw new Error("Product not found");
  }

  // Check if SKU already exists
  const existingVariant = await prisma.productVariant.findFirst({
    where: { sku: data.sku },
  });

  if (existingVariant) {
    throw new Error("SKU already exists");
  }

  const variant = await prisma.productVariant.create({
    data: {
      productId: productId,
      sku: data.sku,
      title: data.title,
      attributes: data.attributes || {},
      isActive: true,
    },
  });

  return variant;
}

/**
 * Update variant
 */
async function updateVariant(
  variantId: number,
  data: {
    sku?: string;
    title?: string;
    attributes?: any;
    isActive?: boolean;
  },
  orgId?: number
) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: true,
    },
  });

  if (!variant) {
    throw new Error("Variant not found");
  }

  if (orgId && variant.product.orgId !== orgId) {
    throw new Error("Unauthorized");
  }

  // Check SKU uniqueness if changing
  if (data.sku && data.sku !== variant.sku) {
    const existing = await prisma.productVariant.findFirst({
      where: {
        sku: data.sku,
        id: { not: variantId },
      },
    });

    if (existing) {
      throw new Error("SKU already exists");
    }
  }

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(data.sku && { sku: data.sku }),
      ...(data.title && { title: data.title }),
      ...(data.attributes !== undefined && { attributes: data.attributes }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  });

  return updated;
}

/**
 * Delete variant
 */
async function deleteVariant(variantId: number, orgId?: number) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: true,
    },
  });

  if (!variant) {
    throw new Error("Variant not found");
  }

  if (orgId && variant.product.orgId !== orgId) {
    throw new Error("Unauthorized");
  }

  // Soft delete: set isActive to false
  const deleted = await prisma.productVariant.update({
    where: { id: variantId },
    data: { isActive: false },
  });

  return deleted;
}

/**
 * Public product verify display (authenticity MVP)
 */
async function getPublicProduct(productId: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });
  if (!product) return null;

  const latestVersion = await prisma.productVersion.findFirst({
    where: { productId: productId, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, description: true, specJson: true },
  });

  return { ...product, latestVersion };
}

/**
 * Create product version (authenticity MVP)
 */
async function createProductVersion({
  productId,
  orgUserId,
  description,
  specJson,
}: {
  productId: number;
  orgUserId: number;
  description?: string;
  specJson?: any;
}) {
  const orgId = await getOrgIdForUser(orgUserId);
  if (!orgId) {
    const err = new Error("You must be a member or owner of an organization");
    (err as any).statusCode = 403;
    throw err;
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    const err = new Error("Product not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (product.orgId !== orgId) {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 403;
    throw err;
  }

  const last = await prisma.productVersion.findFirst({
    where: { productId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (last?.version || 0) + 1;

  const version = await prisma.productVersion.create({
    data: {
      productId,
      version: nextVersion,
      status: "PENDING",
      description: description || null,
      specJson: specJson || null,
      createdByUserId: orgUserId,
    },
  });

  return version;
}

/**
 * Approve product version (admin)
 */
async function approveProductVersion(versionId: number, adminUserId: number) {
  const version = await prisma.productVersion.findUnique({ where: { id: versionId } });
  if (!version) {
    const err = new Error("Version not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (version.status === "APPROVED") return version;

  const updated = await prisma.productVersion.update({
    where: { id: versionId },
    data: { status: "APPROVED" },
  });

  return updated;
}

/**
 * List product versions (filters: productId, status)
 */
async function listProductVersions({ productId, status, page = 1, limit = 20 }: any) {
  const take = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * take;
  const where: any = {};
  if (productId) where.productId = Number(productId);
  if (status) where.status = String(status).toUpperCase();

  const [items, total] = await Promise.all([
    prisma.productVersion.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: { product: true },
    }),
    prisma.productVersion.count({ where }),
  ]);

  return { items, pagination: { page: Number(page), limit: take, total } };
}

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  addVariant,
  updateVariant,
  deleteVariant,
  getPublicProduct,
  createProductVersion,
  approveProductVersion,
  listProductVersions,
};

export {};
