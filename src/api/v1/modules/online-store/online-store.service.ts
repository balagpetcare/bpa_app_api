import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");

/**
 * Get products with aggregated stock from ONLINE_HUB locations only
 */
async function getOnlineProducts(options: {
  categoryId?: number;
  brandId?: number;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {
    approvalStatus: "PUBLISHED",
    status: "ACTIVE",
  };

  if (options.categoryId) where.categoryId = options.categoryId;
  if (options.brandId) where.brandId = options.brandId;
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
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        variants: {
          where: { isActive: true },
          include: {
            stockBalances: {
              where: {
                location: {
                  type: "ONLINE_HUB",
                  isActive: true,
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
              },
            },
            locationPrices: {
              where: {
                location: {
                  type: "ONLINE_HUB",
                  isActive: true,
                },
              },
              include: {
                location: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        media: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          include: {
            media: {
              select: {
                id: true,
                url: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.count({ where }),
  ]);

  // Aggregate stock across ONLINE_HUB locations for each variant
  const productsWithStock = products.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => {
      const totalStock = variant.stockBalances.reduce(
        (sum, balance) => sum + balance.onHandQty - balance.reservedQty,
        0
      );
      const prices = variant.locationPrices.map((lp) => ({
        locationId: lp.locationId,
        locationName: lp.location.name,
        price: lp.price,
      }));

      return {
        ...variant,
        totalAvailableStock: totalStock,
        prices,
      };
    }),
  }));

  return {
    items: productsWithStock,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get variant availability per hub
 */
async function getVariantAvailability(variantId: number) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          approvalStatus: true,
        },
      },
      stockBalances: {
        where: {
          location: {
            type: "ONLINE_HUB",
            isActive: true,
          },
        },
        include: {
          location: {
            select: {
              id: true,
              name: true,
              type: true,
              branch: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      locationPrices: {
        where: {
          location: {
            type: "ONLINE_HUB",
            isActive: true,
          },
        },
        include: {
          location: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!variant) {
    throw new Error("Variant not found");
  }

  if (variant.product.approvalStatus !== "PUBLISHED") {
    throw new Error("Product is not published");
  }

  const availability = variant.stockBalances.map((balance) => ({
    locationId: balance.locationId,
    locationName: balance.location.name,
    branchName: balance.location.branch.name,
    onHandQty: balance.onHandQty,
    reservedQty: balance.reservedQty,
    availableQty: balance.onHandQty - balance.reservedQty,
    price: variant.locationPrices.find((lp) => lp.locationId === balance.locationId)?.price || null,
  }));

  return {
    variant: {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
    },
    product: variant.product,
    availability,
  };
}

/**
 * Choose nearest hub with stock for checkout
 */
async function chooseHubForCheckout(data: {
  items: Array<{ variantId: number; quantity: number }>;
  latitude?: number;
  longitude?: number;
}) {
  // For now, return hubs with sufficient stock
  // Later can add distance calculation based on lat/lng

  const hubs = await prisma.inventoryLocation.findMany({
    where: {
      type: "ONLINE_HUB",
      isActive: true,
    },
    include: {
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const hubAvailability: Array<{
    hubId: number;
    hubName: string;
    branchName: string;
    canFulfill: boolean;
    items: Array<{
      variantId: number;
      available: number;
      required: number;
    }>;
  }> = [];

  for (const hub of hubs) {
    const hubItems: Array<{ variantId: number; available: number; required: number }> = [];
    let canFulfill = true;

    for (const item of data.items) {
      const balance = await ledgerService.getStockBalance(hub.id, item.variantId);
      const available = balance.onHandQty - balance.reservedQty;

      hubItems.push({
        variantId: item.variantId,
        available,
        required: item.quantity,
      });

      if (available < item.quantity) {
        canFulfill = false;
      }
    }

    hubAvailability.push({
      hubId: hub.id,
      hubName: hub.name,
      branchName: hub.branch.name,
      canFulfill,
      items: hubItems,
    });
  }

  // Filter to hubs that can fulfill all items
  const availableHubs = hubAvailability.filter((h) => h.canFulfill);

  return {
    hubs: availableHubs,
    recommended: availableHubs.length > 0 ? availableHubs[0] : null, // Simple: first available
  };
}

module.exports = {
  getOnlineProducts,
  getVariantAvailability,
  chooseHubForCheckout,
};
