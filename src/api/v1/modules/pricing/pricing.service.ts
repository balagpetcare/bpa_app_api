import prisma from "../../../../infrastructure/db/prismaClient";

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

module.exports = {
  setLocationPrice,
  getLocationPrice,
  enableLocationVariant,
};
