const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Get inventory for branch/products
 */
async function getInventory(options: {
  branchId?: number;
  productId?: number;
  variantId?: number;
  lowStockOnly?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (options.branchId) {
    where.branchId = options.branchId;
  }

  if (options.productId) {
    where.productId = options.productId;
  }

  if (options.variantId) {
    where.variantId = options.variantId;
  }

  // Note: lowStockOnly filter will be handled separately in getLowStockAlerts

  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take: limit,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
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
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.inventory.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single inventory item
 */
async function getInventoryById(inventoryId: number, branchId?: number) {
  const where: any = { id: inventoryId };
  if (branchId) {
    where.branchId = branchId;
  }

  const inventory = await prisma.inventory.findFirst({
    where,
    include: {
      branch: true,
      product: {
        include: {
          variants: true,
        },
      },
      variant: true,
    },
  });

  if (!inventory) {
    throw new Error("Inventory item not found");
  }

  return inventory;
}

/**
 * Create or update inventory
 */
async function upsertInventory(data: {
  branchId: number;
  productId: number;
  variantId?: number;
  quantity: number;
  minStock?: number;
  expiryDate?: Date;
}) {
  // Check if inventory exists
  const where: any = {
    branchId: data.branchId,
    productId: data.productId,
  };

  if (data.variantId) {
    where.variantId = data.variantId;
  } else {
    where.variantId = null;
  }

  const existing = await prisma.inventory.findFirst({ where });

  if (existing) {
    // Update existing
    const updated = await prisma.inventory.update({
      where: { id: existing.id },
      data: {
        quantity: data.quantity,
        ...(data.minStock !== undefined && { minStock: data.minStock }),
        ...(data.expiryDate && { expiryDate: data.expiryDate }),
      },
      include: {
        branch: true,
        product: true,
        variant: true,
      },
    });

    return updated;
  } else {
    // Create new
    const created = await prisma.inventory.create({
      data: {
        branchId: data.branchId,
        productId: data.productId,
        variantId: data.variantId || null,
        quantity: data.quantity,
        minStock: data.minStock || 10,
        expiryDate: data.expiryDate || null,
      },
      include: {
        branch: true,
        product: true,
        variant: true,
      },
    });

    return created;
  }
}

/**
 * Adjust stock (add or remove)
 */
async function adjustStock(
  inventoryId: number,
  data: {
    type: "IN" | "OUT" | "ADJUST";
    quantity: number;
    reason?: string;
    createdByUserId?: number;
  },
  branchId?: number
) {
  // Verify inventory exists
  const where: any = { id: inventoryId };
  if (branchId) {
    where.branchId = branchId;
  }

  const inventory = await prisma.inventory.findFirst({ where });
  if (!inventory) {
    throw new Error("Inventory item not found");
  }

  let newQuantity = inventory.quantity;

  if (data.type === "IN") {
    newQuantity = inventory.quantity + data.quantity;
  } else if (data.type === "OUT") {
    newQuantity = inventory.quantity - data.quantity;
    if (newQuantity < 0) {
      throw new Error("Insufficient stock");
    }
  } else if (data.type === "ADJUST") {
    newQuantity = data.quantity;
  }

  // Update inventory
  const updated = await prisma.inventory.update({
    where: { id: inventoryId },
    data: { quantity: newQuantity },
  });

  // Create transaction record
  await prisma.stockTransaction.create({
    data: {
      inventoryId: inventoryId,
      type: data.type,
      quantity: data.quantity,
      reason: data.reason || null,
      createdByUserId: data.createdByUserId || null,
    },
  });

  return updated;
}

/**
 * Transfer stock between branches
 */
async function transferStock(
  fromInventoryId: number,
  data: {
    toBranchId: number;
    quantity: number;
    reason?: string;
    createdByUserId?: number;
  },
  branchId?: number
) {
  // Verify source inventory
  const where: any = { id: fromInventoryId };
  if (branchId) {
    where.branchId = branchId;
  }

  const sourceInventory = await prisma.inventory.findFirst({ where });
  if (!sourceInventory) {
    throw new Error("Source inventory not found");
  }

  if (sourceInventory.quantity < data.quantity) {
    throw new Error("Insufficient stock for transfer");
  }

  // Reduce from source
  await adjustStock(
    fromInventoryId,
    {
      type: "OUT",
      quantity: data.quantity,
      reason: data.reason || `Transfer to branch ${data.toBranchId}`,
      createdByUserId: data.createdByUserId,
    },
    branchId
  );

  // Add to destination
  await upsertInventory({
    branchId: data.toBranchId,
    productId: sourceInventory.productId,
    variantId: sourceInventory.variantId || undefined,
    quantity: data.quantity,
    minStock: sourceInventory.minStock,
  });

  // Create transfer transaction
  await prisma.stockTransaction.create({
    data: {
      inventoryId: fromInventoryId,
      type: "TRANSFER",
      quantity: data.quantity,
      reason: data.reason || `Transfer to branch ${data.toBranchId}`,
      createdByUserId: data.createdByUserId || null,
    },
  });

  return { success: true, message: "Stock transferred successfully" };
}

/**
 * Get low stock alerts
 */
async function getLowStockAlerts(branchId?: number) {
  const where: any = {
    quantity: {
      lte: prisma.raw("min_stock"),
    },
  };

  if (branchId) {
    where.branchId = branchId;
  }

  const alerts = await prisma.inventory.findMany({
    where,
    include: {
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
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
    },
    orderBy: { quantity: "asc" },
  });

  return alerts;
}

/**
 * Get expiring items
 */
async function getExpiringItems(branchId?: number, daysAhead: number = 30) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);

  const where: any = {
      expiryDate: {
        lte: futureDate,
        gte: new Date(),
      },
    };

  if (branchId) {
    where.branchId = branchId;
  }

  const items = await prisma.inventory.findMany({
    where,
    include: {
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
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
    },
    orderBy: { expiryDate: "asc" },
  });

  return items;
}

/**
 * Get ledger-derived inventory summary (v2)
 */
async function getInventorySummaryV2(options: {
  locationId?: number;
  branchId?: number;
  productId?: number;
  variantId?: number;
  search?: string;
  lowStockOnly?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.locationId) where.locationId = options.locationId;
  if (options.branchId) where.location = { branchId: options.branchId };
  if (options.variantId) where.variantId = options.variantId;
  if (options.productId) {
    where.variant = where.variant || {};
    where.variant.productId = options.productId;
  }
  if (options.search) {
    where.variant = where.variant || {};
    where.variant.product = {
      OR: [
        { name: { contains: options.search, mode: "insensitive" } },
        { slug: { contains: options.search, mode: "insensitive" } },
      ],
    };
  }
  if (options.lowStockOnly) where.onHandQty = { lte: 10 };

  const [balances, total] = await Promise.all([
    prisma.stockBalance.findMany({
      where,
      skip,
      take: limit,
      include: {
        location: {
          select: {
            id: true,
            name: true,
            type: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            product: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.stockBalance.count({ where }),
  ]);

  const items = balances.map((b) => ({
    id: `loc-${b.locationId}-var-${b.variantId}`,
    locationId: b.locationId,
    variantId: b.variantId,
    productId: b.variant?.product?.id,
    quantity: b.onHandQty,
    reservedQty: b.reservedQty,
    availableQty: b.onHandQty - b.reservedQty,
    location: b.location,
    product: b.variant?.product,
    variant: b.variant ? { id: b.variant.id, sku: b.variant.sku, title: b.variant.title } : null,
  }));

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get lot-wise stock for a location + variant
 * @param excludeExpired - When true (default), hides expired lots for selectors
 */
async function getInventoryLots(options: {
  locationId: number;
  variantId?: number;
  excludeExpired?: boolean;
}) {
  const where: any = { locationId: options.locationId };
  where.lot = where.lot || {};
  if (options.variantId) {
    where.lot.variantId = options.variantId;
  }
  if (options.excludeExpired !== false) {
    where.lot.expDate = { gt: new Date() };
  }

  const lotBalances = await prisma.stockLotBalance.findMany({
    where,
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          mfgDate: true,
          expDate: true,
          variantId: true,
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
    },
    orderBy: { lot: { expDate: "asc" } },
  });

  return lotBalances.map((lb) => ({
    lotId: lb.lotId,
    lot: lb.lot,
    onHandQty: lb.onHandQty,
    reservedQty: lb.reservedQty,
    availableQty: lb.onHandQty - lb.reservedQty,
  }));
}

/**
 * Get user-accessible inventory locations
 */
async function getInventoryLocations(userId: number) {
  const member = await prisma.branchMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true, orgId: true },
  });
  const ownerOrg = await prisma.organization.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });

  const branchIds: number[] = [];
  if (member?.branchId) branchIds.push(member.branchId);
  if (ownerOrg) {
    const branches = await prisma.branch.findMany({
      where: { orgId: ownerOrg.id },
      select: { id: true },
    });
    branchIds.push(...branches.map((b) => b.id));
  }

  const locations = await prisma.inventoryLocation.findMany({
    where: { branchId: { in: [...new Set(branchIds)] }, isActive: true },
    include: { branch: { select: { id: true, name: true } } },
  });

  return locations;
}

/**
 * Get expiring lots (v2 - lot-based)
 */
async function getExpiringItemsV2(options: {
  branchId?: number;
  locationId?: number;
  daysAhead?: number;
}) {
  const daysAhead = options.daysAhead ?? 30;
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const now = new Date();

  const where: any = {
    lot: {
      expDate: { gte: now, lte: futureDate },
    },
    onHandQty: { gt: 0 },
  };
  if (options.locationId) where.locationId = options.locationId;
  if (options.branchId) where.location = { branchId: options.branchId };

  const items = await prisma.stockLotBalance.findMany({
    where,
    include: {
      location: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { lot: { expDate: "asc" } },
  });

  return items.map((i) => ({
    id: i.lotId,
    quantity: i.onHandQty,
    expiryDate: i.lot.expDate,
    product: i.lot.variant?.product,
    variant: i.lot.variant,
    branch: i.location?.branch,
    lot: i.lot,
  }));
}

/**
 * Get low stock alerts (v2 - ledger-based)
 */
async function getLowStockAlertsV2(options: { branchId?: number; locationId?: number }) {
  const where: any = { onHandQty: { lte: 10 } };
  if (options.locationId) where.locationId = options.locationId;
  if (options.branchId) where.location = { branchId: options.branchId };

  const balances = await prisma.stockBalance.findMany({
    where,
    include: {
      location: { include: { branch: { select: { id: true, name: true } } } },
      variant: {
        select: {
          id: true,
          sku: true,
          title: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
  });

  return balances.map((b) => ({
    id: `loc-${b.locationId}-var-${b.variantId}`,
    quantity: b.onHandQty,
    product: b.variant?.product,
    variant: b.variant,
    branch: b.location?.branch,
    location: b.location,
  }));
}

module.exports = {
  getInventory,
  getInventoryById,
  upsertInventory,
  adjustStock,
  transferStock,
  getLowStockAlerts,
  getExpiringItems,
  getInventorySummaryV2,
  getInventoryLots,
  getInventoryLocations,
  getExpiringItemsV2,
  getLowStockAlertsV2,
};

export {};
