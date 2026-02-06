import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * Create vendor
 */
async function createVendor(data: {
  orgId: number;
  name: string;
  contactJson?: any;
}) {
  const vendor = await prisma.vendor.create({
    data: {
      orgId: data.orgId,
      name: data.name,
      contactJson: data.contactJson || {},
      status: "ACTIVE",
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return vendor;
}

/**
 * Create vendor product listing (draft)
 */
async function createVendorListing(data: {
  vendorId: number;
  productId: number;
  variantId?: number;
  commissionRuleId?: number;
}) {
  const listing = await prisma.vendorProductListing.create({
    data: {
      vendorId: data.vendorId,
      productId: data.productId,
      variantId: data.variantId || null,
      status: "DRAFT",
      commissionRuleId: data.commissionRuleId || null,
    },
    include: {
      vendor: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
        },
      },
      commissionRule: {
        select: {
          id: true,
          name: true,
          type: true,
          value: true,
        },
      },
    },
  });

  return listing;
}

/**
 * Approve vendor listing
 */
async function approveVendorListing(listingId: number) {
  const listing = await prisma.vendorProductListing.update({
    where: { id: listingId },
    data: {
      status: "APPROVED",
    },
    include: {
      vendor: true,
      product: true,
      variant: true,
      commissionRule: true,
    },
  });

  return listing;
}

/**
 * Get vendor listings with filters
 */
async function getVendorListings(options: {
  vendorId?: number;
  productId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.vendorId) where.vendorId = options.vendorId;
  if (options.productId) where.productId = options.productId;
  if (options.status) where.status = options.status;

  const [listings, total] = await Promise.all([
    prisma.vendorProductListing.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
          },
        },
        commissionRule: {
          select: {
            id: true,
            name: true,
            type: true,
            value: true,
          },
        },
      },
    }),
    prisma.vendorProductListing.count({ where }),
  ]);

  return {
    items: listings,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Create commission rule
 */
async function createCommissionRule(data: {
  name: string;
  type: string; // PERCENT or FIXED
  value: number;
  orgId?: number;
  isDefault?: boolean;
}) {
  const rule = await prisma.commissionRule.create({
    data: {
      name: data.name,
      type: data.type as any,
      value: data.value,
      orgId: data.orgId || null,
      isDefault: data.isDefault || false,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return rule;
}

module.exports = {
  createVendor,
  createVendorListing,
  approveVendorListing,
  getVendorListings,
  createCommissionRule,
};
