import prisma from "../../../../infrastructure/db/prismaClient";
const { resolveSellingPrice } = require("./pricingEngine.service");

/**
 * Set location price
 */
async function setLocationPrice(data: {
  locationId: number;
  variantId: number;
  price: number;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}) {
  // Upsert location price
  const locationPrice = await prisma.locationPrice.upsert({
    where: {
      locationId_variantId: {
        locationId: data.locationId,
        variantId: data.variantId,
      },
    },
    update: {
      price: data.price,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo || null,
    },
    create: {
      locationId: data.locationId,
      variantId: data.variantId,
      price: data.price,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo || null,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
    },
  });

  return locationPrice;
}

/**
 * Get location price
 */
async function getLocationPrice(locationId: number, variantId: number) {
  const price = await prisma.locationPrice.findUnique({
    where: {
      locationId_variantId: {
        locationId,
        variantId,
      },
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
    },
  });

  return price;
}

/**
 * Resolved selling price (branch override → product pricing → location price).
 */
async function getResolvedSellingPrice(params: {
  orgId: number;
  variantId: number;
  branchId?: number | null;
  locationId?: number | null;
}) {
  return resolveSellingPrice(params);
}

/**
 * Enable/disable variant at location with channel config
 */
async function enableLocationVariant(data: {
  locationId: number;
  variantId: number;
  channel: string; // POS_ONLY, ONLINE_ONLY, BOTH
  isEnabled: boolean;
}) {
  const config = await prisma.locationVariantConfig.upsert({
    where: {
      locationId_variantId: {
        locationId: data.locationId,
        variantId: data.variantId,
      },
    },
    update: {
      channel: data.channel as any,
      isEnabled: data.isEnabled,
    },
    create: {
      locationId: data.locationId,
      variantId: data.variantId,
      channel: data.channel as any,
      isEnabled: data.isEnabled,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
    },
  });

  return config;
}

/**
 * List org-level product pricings
 */
async function listOrgPricing(params: {
  orgId: number;
  page: number;
  limit: number;
  q?: string;
  categoryId?: number;
  unpricedOnly?: boolean;
  sortBy?: "updatedAt" | "sku" | "basePrice";
  sortOrder?: "asc" | "desc";
}) {
  const skip = (params.page - 1) * params.limit;
  const q = params.q?.trim();
  const where: any = { orgId: params.orgId };

  if (params.unpricedOnly) {
    where.basePrice = null;
  }

  if (params.categoryId && q) {
    where.variant = {
      AND: [
        { product: { categoryId: params.categoryId } },
        {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { product: { name: { contains: q, mode: "insensitive" } } },
          ],
        },
      ],
    };
  } else if (params.categoryId) {
    where.variant = { product: { categoryId: params.categoryId } };
  } else if (q) {
    where.OR = [
      { variant: { sku: { contains: q, mode: "insensitive" } } },
      { variant: { title: { contains: q, mode: "insensitive" } } },
      { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const sortBy = params.sortBy || "updatedAt";
  const sortOrder = params.sortOrder === "asc" ? "asc" : "desc";
  let orderBy: any = { updatedAt: sortOrder };
  if (sortBy === "sku") orderBy = { variant: { sku: sortOrder } };
  if (sortBy === "basePrice") orderBy = { basePrice: sortOrder };

  const [items, total] = await Promise.all([
    prisma.productPricing.findMany({
      where,
      skip,
      take: params.limit,
      orderBy,
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            unitId: true,
            unit: { select: { id: true, code: true, name: true } },
            product: {
              select: {
                id: true,
                name: true,
                categoryId: true,
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.productPricing.count({
      where,
    }),
  ]);

  return { items, total };
}

/**
 * Distinct product categories that appear on org catalog pricing rows (for filter UI).
 */
async function listOrgPricingMeta(orgId: number) {
  const products = await prisma.product.findMany({
    where: { orgId, OR: [{ categoryId: { not: null } }, { brandId: { not: null } }] },
    select: {
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
    },
    take: 8000,
  });
  const catMap = new Map<number, { id: number; name: string }>();
  const brandMap = new Map<number, { id: number; name: string }>();
  for (const p of products) {
    if (p.category) catMap.set(p.category.id, { id: p.category.id, name: p.category.name });
    if (p.brand) brandMap.set(p.brand.id, { id: p.brand.id, name: p.brand.name });
  }
  const categories = Array.from(catMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const brands = Array.from(brandMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { categories, brands };
}

/**
 * Set org-level product pricing (upsert)
 */
async function setOrgPricing(data: {
  orgId: number;
  variantId: number;
  basePrice?: number | null;
  markupPercent?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  mrp?: number | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}) {
  const pricing = await prisma.productPricing.upsert({
    where: {
      orgId_variantId: {
        orgId: data.orgId,
        variantId: data.variantId,
      },
    },
    update: {
      basePrice: data.basePrice ?? null,
      markupPercent: data.markupPercent ?? null,
      minPrice: data.minPrice ?? null,
      maxPrice: data.maxPrice ?? null,
      mrp: data.mrp ?? null,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo ?? null,
    },
    create: {
      orgId: data.orgId,
      variantId: data.variantId,
      basePrice: data.basePrice ?? null,
      markupPercent: data.markupPercent ?? null,
      minPrice: data.minPrice ?? null,
      maxPrice: data.maxPrice ?? null,
      mrp: data.mrp ?? null,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo ?? null,
    },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return pricing;
}

/**
 * List branch pricing overrides
 */
async function listBranchPricing(params: { branchId: number; page: number; limit: number }) {
  const skip = (params.page - 1) * params.limit;

  const [items, total] = await Promise.all([
    prisma.branchPricing.findMany({
      where: { branchId: params.branchId },
      skip,
      take: params.limit,
      orderBy: { updatedAt: "desc" },
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            product: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            orgId: true,
          },
        },
      },
    }),
    prisma.branchPricing.count({
      where: { branchId: params.branchId },
    }),
  ]);

  return { items, total };
}

/**
 * Set branch pricing override (upsert)
 */
async function setBranchPricing(data: {
  branchId: number;
  variantId: number;
  overridePrice: number;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}) {
  const pricing = await prisma.branchPricing.upsert({
    where: {
      branchId_variantId: {
        branchId: data.branchId,
        variantId: data.variantId,
      },
    },
    update: {
      overridePrice: data.overridePrice,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo ?? null,
    },
    create: {
      branchId: data.branchId,
      variantId: data.variantId,
      overridePrice: data.overridePrice,
      effectiveFrom: data.effectiveFrom || new Date(),
      effectiveTo: data.effectiveTo ?? null,
    },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
          orgId: true,
        },
      },
    },
  });

  return pricing;
}

/**
 * Bulk upsert org pricing rows (same validation as single upsert — caller must validate each row).
 */
async function bulkUpsertOrgPricing(
  orgId: number,
  rows: Array<{
    variantId: number;
    basePrice?: number | null;
    markupPercent?: number | null;
    minPrice?: number | null;
    maxPrice?: number | null;
    mrp?: number | null;
  }>
) {
  const out = [];
  for (const r of rows) {
    const row = await setOrgPricing({
      orgId,
      variantId: r.variantId,
      basePrice: r.basePrice,
      markupPercent: r.markupPercent,
      minPrice: r.minPrice,
      maxPrice: r.maxPrice,
      mrp: r.mrp,
    });
    out.push(row);
  }
  return { updated: out.length, items: out };
}

module.exports = {
  setLocationPrice,
  getLocationPrice,
  getResolvedSellingPrice,
  enableLocationVariant,
  listOrgPricing,
  listOrgPricingMeta,
  setOrgPricing,
  bulkUpsertOrgPricing,
  listBranchPricing,
  setBranchPricing,
};
