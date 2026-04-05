const prisma = require("../../../../infrastructure/db/prismaClient");
const { resolveOrgIdForLocation } = require("./stockAvailability.service");
const { getManagedBranchesForUser } = require("../../services/branchManager.service");
const {
  getNonLotEffectiveAtLocation,
  getFefoEligibleLotTotal,
} = require("./fefoAllocation.service");

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
  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
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
  if (branchId != null && inventory.branchId !== branchId) {
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

  const existingRows = await prisma.inventory.findMany({ where, take: 1 });
  const existing = existingRows[0];

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
 * @param tx Optional transaction client (e.g. POS sale legacy path atomic with order).
 */
async function adjustStock(
  inventoryId: number,
  data: {
    type: "IN" | "OUT" | "ADJUST";
    quantity: number;
    reason?: string;
    createdByUserId?: number;
  },
  branchId?: number,
  tx?: any
) {
  const db = tx || prisma;
  // Verify inventory exists
  const inventory = await db.inventory.findUnique({ where: { id: inventoryId } });
  if (!inventory) {
    throw new Error("Inventory item not found");
  }
  if (branchId != null && inventory.branchId !== branchId) {
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
  const updated = await db.inventory.update({
    where: { id: inventoryId },
    data: { quantity: newQuantity },
  });

  // Create transaction record
  await db.stockTransaction.create({
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
  const sourceInventory = await prisma.inventory.findUnique({ where: { id: fromInventoryId } });
  if (!sourceInventory) {
    throw new Error("Source inventory not found");
  }
  if (branchId != null && sourceInventory.branchId !== branchId) {
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
    const { fefoLotExpDateEligibleFilter } = require("./lotExpiryCalendar");
    where.lot.expDate = fefoLotExpDateEligibleFilter();
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
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
              requiresExpiry: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
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

/** Computed batch row status for owner/branch UIs. */
function computeLotRowStatus(
  expDate: Date,
  availableQty: number,
  now: Date,
  nearExpiryDays: number
): "DEPLETED" | "EXPIRED" | "NEAR_EXPIRY" | "ACTIVE" {
  if (availableQty <= 0) return "DEPLETED";
  const { isLotExpiredByCalendarDayUtc } = require("./lotExpiryCalendar");
  if (isLotExpiredByCalendarDayUtc(expDate, now)) return "EXPIRED";
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.ceil((expDate.getTime() - now.getTime()) / msPerDay);
  if (days >= 0 && days <= nearExpiryDays) return "NEAR_EXPIRY";
  return "ACTIVE";
}

/**
 * Enriched batch rows for GET /inventory/batches (flat product/variant + legacy `lot` nested).
 * Filters invalid rows (missing variant) and optionally zero-qty and expired lots.
 */
async function getInventoryBatches(options: {
  locationId: number;
  variantId?: number;
  hideZeroQty?: boolean;
  excludeExpired?: boolean;
  nearExpiryDays?: number;
}) {
  const hideZeroQty = options.hideZeroQty !== false;
  const excludeExpired = options.excludeExpired !== false;
  const nearExpiryDays = options.nearExpiryDays ?? 90;
  const now = new Date();

  const where: Record<string, unknown> = { locationId: options.locationId };
  const lotWhere: Record<string, unknown> = {};
  if (options.variantId) lotWhere.variantId = options.variantId;
  if (excludeExpired) {
    const { fefoLotExpDateEligibleFilter } = require("./lotExpiryCalendar");
    lotWhere.expDate = fefoLotExpDateEligibleFilter();
  }
  if (Object.keys(lotWhere).length) (where as { lot: unknown }).lot = lotWhere;
  if (hideZeroQty) {
    (where as { onHandQty: unknown }).onHandQty = { gt: 0 };
  }

  const lotBalances = await prisma.stockLotBalance.findMany({
    where: where as any,
    include: {
      location: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true, orgId: true } },
        },
      },
      lot: {
        select: {
          id: true,
          orgId: true,
          lotCode: true,
          mfgDate: true,
          expDate: true,
          variantId: true,
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
              requiresExpiry: true,
              requiresMfg: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
    orderBy: { lot: { expDate: "asc" } },
  });

  const rows: any[] = [];
  for (const lb of lotBalances) {
    if (!lb.lot?.variant) continue;
    const availableQty = lb.onHandQty - (lb.reservedQty ?? 0);
    const exp = lb.lot.expDate;
    const status = computeLotRowStatus(exp, availableQty, now, nearExpiryDays);

    const product = lb.lot.variant.product
      ? { id: lb.lot.variant.product.id, name: lb.lot.variant.product.name, slug: lb.lot.variant.product.slug }
      : null;
    const variant = {
      id: lb.lot.variant.id,
      sku: lb.lot.variant.sku,
      title: lb.lot.variant.title,
      requiresExpiry: lb.lot.variant.requiresExpiry,
      requiresMfg: lb.lot.variant.requiresMfg,
    };

    rows.push({
      lotId: lb.lotId,
      locationId: lb.locationId,
      lotCode: lb.lot.lotCode,
      mfgDate: lb.lot.mfgDate,
      expDate: lb.lot.expDate,
      expiryDate: lb.lot.expDate,
      product,
      variant,
      onHandQty: lb.onHandQty,
      reservedQty: lb.reservedQty,
      availableQty,
      quantity: lb.onHandQty,
      status,
      lot: lb.lot,
      location: lb.location,
    });
  }

  return rows;
}

/** Stable ordering for pickers: branch name, then location name. */
const INVENTORY_LOCATION_ORDER_BY = [{ branch: { name: "asc" } }, { name: "asc" }] as const;

async function userCanAccessOrgForLocations(userId: number, orgId: number): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { ownerUserId: true },
  });
  if (org?.ownerUserId === userId) return true;
  const members = await prisma.branchMember.findMany({
    where: { userId, orgId, status: "ACTIVE" },
    take: 1,
    select: { id: true },
  });
  return members.length > 0;
}

/**
 * Get user-accessible inventory locations.
 * @param options.orgId When set, only branches for that org (caller must be owner or active member of that org).
 * When omitted, unions all branches for every org the user owns plus the member branch (if any).
 * @param options.warehouseId When set, filter to locations for this warehouse (must belong to org when orgId is set).
 */
async function getInventoryLocations(
  userId: number,
  options?: { orgId?: number; warehouseId?: number }
) {
  if (options?.orgId != null && Number.isFinite(options.orgId) && options.orgId > 0) {
    const oid = Number(options.orgId);
    const ok = await userCanAccessOrgForLocations(userId, oid);
    if (!ok) {
      const err = new Error("Not authorized to list locations for this organization");
      (err as { code?: string }).code = "FORBIDDEN_ORG";
      throw err;
    }
    const branches = await prisma.branch.findMany({
      where: { orgId: oid },
      select: { id: true },
    });
    const branchIds = branches.map((b) => b.id);
    if (!branchIds.length) return [];
    const whereLoc: Record<string, unknown> = { branchId: { in: branchIds }, isActive: true };
    if (options.warehouseId != null && Number.isFinite(options.warehouseId)) {
      whereLoc.warehouseId = options.warehouseId;
    }
    return prisma.inventoryLocation.findMany({
      where: whereLoc as any,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            orgId: true,
            typeLinks: {
              select: {
                isPrimary: true,
                branchType: { select: { code: true, nameEn: true } },
              },
            },
          },
        },
      },
      orderBy: INVENTORY_LOCATION_ORDER_BY as unknown as Record<string, string>[],
    });
  }

  const memberRows = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    take: 1,
    select: { branchId: true, orgId: true },
  });
  const member = memberRows[0];
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });

  const branchIds: number[] = [];
  if (member?.branchId) branchIds.push(member.branchId);
  if (ownedOrgs.length) {
    const branches = await prisma.branch.findMany({
      where: { orgId: { in: ownedOrgs.map((o) => o.id) } },
      select: { id: true },
    });
    branchIds.push(...branches.map((b) => b.id));
  }

  const unique = [...new Set(branchIds)];
  if (!unique.length) return [];

  const whereFallback: Record<string, unknown> = { branchId: { in: unique }, isActive: true };
  if (options?.warehouseId != null && Number.isFinite(options.warehouseId)) {
    whereFallback.warehouseId = options.warehouseId;
  }

  return prisma.inventoryLocation.findMany({
    where: whereFallback as any,
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          orgId: true,
          typeLinks: {
            select: {
              isPrimary: true,
              branchType: { select: { code: true, nameEn: true } },
            },
          },
        },
      },
    },
    orderBy: INVENTORY_LOCATION_ORDER_BY as unknown as Record<string, string>[],
  });
}

/**
 * Get expiring lots (v2 - lot-based)
 */
async function getExpiringItemsV2(options: {
  branchId?: number;
  locationId?: number;
  orgId?: number;
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
  if (options.branchId || options.orgId) {
    where.location = {};
    if (options.branchId) where.location.branchId = options.branchId;
    if (options.orgId) where.location.branch = { orgId: options.orgId };
  }

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
          mfgDate: true,
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

  return items
    .map((i) => {
      const availableQty = i.onHandQty - (i.reservedQty ?? 0);
      const exp = i.lot.expDate;
      const daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return {
        id: i.lotId,
        lotId: i.lotId,
        lotCode: i.lot.lotCode,
        quantity: i.onHandQty,
        onHandQty: i.onHandQty,
        reservedQty: i.reservedQty,
        availableQty,
        expiryDate: exp,
        expDate: exp,
        mfgDate: i.lot.mfgDate,
        daysUntilExpiry,
        product: i.lot.variant?.product,
        variant: i.lot.variant,
        branch: i.location?.branch,
        location: i.location,
        lot: i.lot,
      };
    })
    .filter((row) => row.availableQty > 0);
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

/**
 * Report: current stock balance by location/variant (ledger-derived StockBalance)
 */
async function getStockBalanceReport(options: {
  locationId?: number;
  variantId?: number;
  orgId?: number;
}) {
  const where: any = {};
  if (options.locationId) where.locationId = options.locationId;
  if (options.variantId) where.variantId = options.variantId;
  if (options.orgId) where.location = { branch: { orgId: options.orgId } };

  const balances = await prisma.stockBalance.findMany({
    where,
    include: {
      location: { include: { branch: { select: { id: true, name: true, orgId: true } } } },
      variant: { select: { id: true, sku: true, title: true } },
    },
  });
  return balances.map((b) => ({
    locationId: b.locationId,
    variantId: b.variantId,
    onHandQty: b.onHandQty,
    reservedQty: b.reservedQty,
    location: b.location,
    variant: b.variant,
  }));
}

/**
 * Report: stock by lot with expiry buckets (0-30, 31-90, 90+ days)
 */
async function getStockByLotExpiryReport(options: { locationId?: number; variantId?: number }) {
  const where: any = { onHandQty: { gt: 0 } };
  if (options.locationId) where.locationId = options.locationId;
  if (options.variantId) where.lot = { variantId: options.variantId };

  const lotBalances = await prisma.stockLotBalance.findMany({
    where,
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          variantId: true,
          variant: { select: { id: true, sku: true, title: true } },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });

  const now = new Date();
  const bucket = (expDate: Date) => {
    const days = Math.ceil((expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (days < 0) return "expired";
    if (days <= 30) return "0-30";
    if (days <= 90) return "31-90";
    return "90+";
  };

  const byBucket: Record<string, any[]> = { expired: [], "0-30": [], "31-90": [], "90+": [] };
  for (const lb of lotBalances) {
    const b = bucket(lb.lot.expDate);
    byBucket[b].push({
      lotId: lb.lotId,
      lot: lb.lot,
      onHandQty: lb.onHandQty,
      reservedQty: lb.reservedQty,
      locationId: lb.locationId,
      location: lb.location,
      expiryBucket: b,
    });
  }
  return { byBucket, items: lotBalances };
}

/**
 * Search variants for product picker (bulk receive, etc.).
 * orgIds: orgs the user can access; q: search string (sku, barcode, title, product name).
 */
async function getVariantsSearch(options: {
  orgIds: number[];
  q?: string;
  limit?: number;
  page?: number;
}) {
  const limit = Math.min(options.limit ?? 20, 100);
  const page = options.page ?? 1;
  const skip = (page - 1) * limit;
  const where: any = { product: { orgId: { in: options.orgIds } }, isActive: true };
  if (options.q && options.q.trim()) {
    const q = options.q.trim();
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { barcode: q },
      { product: { name: { contains: q, mode: "insensitive" } } },
      { product: { slug: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
      select: {
        id: true,
        sku: true,
        title: true,
        barcode: true,
        productId: true,
        requiresLot: true,
        requiresExpiry: true,
        requiresMfg: true,
        product: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.productVariant.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Stock valuation (FIFO or Weighted Average) for a location, optionally by variant.
 * method: FIFO | WEIGHTED_AVG. Returns totalValue, totalQty, unitCost (avg), breakdown by variant if no variantId.
 */
async function getValuation(options: {
  locationId: number;
  variantId?: number;
  method?: "FIFO" | "WEIGHTED_AVG";
}) {
  const method = options.method === "FIFO" ? "FIFO" : "WEIGHTED_AVG";
  const where: any = { locationId: options.locationId, quantityDelta: { gt: 0 } };
  if (options.variantId) where.variantId = options.variantId;
  const entries = await prisma.stockLedger.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { variantId: true, quantityDelta: true, unitCost: true },
  });
  const balances = await prisma.stockBalance.findMany({
    where: { locationId: options.locationId, ...(options.variantId ? { variantId: options.variantId } : {}), onHandQty: { gt: 0 } },
    select: { variantId: true, onHandQty: true },
  });
  let totalValue = 0;
  const byVariant: Record<number, { onHandQty: number; value: number; unitCost?: number }> = {};
  for (const b of balances) {
    const inEntries = entries.filter((e) => e.variantId === b.variantId);
    const totalCost = inEntries.reduce((s, e) => s + (Number(e.unitCost || 0) * e.quantityDelta), 0);
    const totalInQty = inEntries.reduce((s, e) => s + e.quantityDelta, 0);
    const avgCost = totalInQty > 0 ? totalCost / totalInQty : 0;
    const value = method === "WEIGHTED_AVG" ? b.onHandQty * avgCost : b.onHandQty * avgCost;
    totalValue += value;
    byVariant[b.variantId] = { onHandQty: b.onHandQty, value, unitCost: totalInQty > 0 ? avgCost : undefined };
  }
  const totalQty = balances.reduce((s, b) => s + b.onHandQty, 0);
  const overallAvg = totalQty > 0 ? totalValue / totalQty : 0;
  return {
    method,
    locationId: options.locationId,
    variantId: options.variantId ?? null,
    totalQty,
    totalValue,
    unitCost: totalQty > 0 ? overallAvg : null,
    byVariant: options.variantId ? undefined : byVariant,
  };
}

/**
 * Dashboard cards: total SKUs with stock, low stock count, expiring (7d) count.
 * Optional: branchId, locationId, orgId to scope.
 */
async function getInventoryDashboardCards(options: { branchId?: number; locationId?: number; orgId?: number }) {
  const whereBalance: any = { onHandQty: { gt: 0 } };
  if (options.locationId) whereBalance.locationId = options.locationId;
  if (options.branchId) whereBalance.location = { branchId: options.branchId };
  if (options.orgId) whereBalance.location = { ...whereBalance.location, branch: { orgId: options.orgId } };

  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);
  const whereExpiring: any = {
    onHandQty: { gt: 0 },
    lot: { expDate: { gte: now, lte: in7 } },
  };
  if (options.locationId) whereExpiring.locationId = options.locationId;
  if (options.branchId) whereExpiring.location = { branchId: options.branchId };
  if (options.orgId) whereExpiring.location = { ...whereExpiring.location, branch: { orgId: options.orgId } };

  const [totalSkus, lowStockCount, expiringCount] = await Promise.all([
    prisma.stockBalance.count({ where: { ...whereBalance, onHandQty: { gt: 0 } } }),
    prisma.stockBalance.count({ where: { ...whereBalance, onHandQty: { lte: 10 } } }),
    prisma.stockLotBalance.count({ where: whereExpiring }),
  ]);

  return { totalSkus, lowStockCount, expiringCount };
}

/** Domain rule — see docs/inventory-stock-request-product-picker-audit-and-fix-plan.md */
const STOCK_REQUEST_PICKER_RULE =
  "BRANCH_LOCAL_STOCK_PLUS_CENTRAL_SUPPLY_PLUS_ZERO_BRANCH_CATALOG";

const MAX_STOCK_REQUEST_PICKER_PRODUCTS = 5000;

async function ensureDefaultBranchInventoryLocation(branchId: number, branchName: string | null) {
  const n = await prisma.inventoryLocation.count({ where: { branchId } });
  if (n > 0) return false;
  await prisma.inventoryLocation.create({
    data: {
      branchId,
      type: "SHOP",
      name: branchName ? `${branchName} - Main` : "Main",
      code: null,
      isActive: true,
    },
  });
  return true;
}

/**
 * Get products for stock request picker with batch/expiry intelligence.
 * Returns org ACTIVE catalog (including zero branch stock), branch-local + central balances.
 */
async function getStockRequestProducts(options: {
  branchId: number;
  userId: number;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
  stockStatus?: string;
}) {
  const limit = Math.min(options.limit ?? 30, 100);
  const page = options.page ?? 1;

  let branch = await prisma.branch.findUnique({
    where: { id: options.branchId },
    select: {
      id: true,
      orgId: true,
      name: true,
      inventoryLocations: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!branch) throw new Error("Branch not found");

  let defaultLocationCreated = false;
  if (branch.inventoryLocations.length === 0) {
    defaultLocationCreated = await ensureDefaultBranchInventoryLocation(options.branchId, branch.name);
    if (defaultLocationCreated) {
      branch = await prisma.branch.findUnique({
        where: { id: options.branchId },
        select: {
          id: true,
          orgId: true,
          name: true,
          inventoryLocations: { where: { isActive: true }, select: { id: true } },
        },
      });
      if (!branch) throw new Error("Branch not found");
    }
  }

  const branchLocationIds = (branch?.inventoryLocations ?? []).map((l) => l.id);
  const centralLocs = await prisma.inventoryLocation.findMany({
    where: {
      isActive: true,
      warehouseId: { not: null },
      warehouse: { orgId: branch.orgId },
    },
    select: { id: true },
  });
  const centralLocationIds = centralLocs.map((l) => l.id);
  const balanceLocationIds = [...new Set([...branchLocationIds, ...centralLocationIds])];

  const where: any = { orgId: branch.orgId, status: "ACTIVE" };
  if (options.search && options.search.trim()) {
    const s = options.search.trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      {
        variants: {
          some: {
            isActive: true,
            OR: [
              { sku: { contains: s, mode: "insensitive" } },
              { barcode: { contains: s, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const rawCount = await prisma.product.count({ where });
  const products = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    take: MAX_STOCK_REQUEST_PICKER_PRODUCTS + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      variants: {
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          title: true,
          barcode: true,
          productId: true,
          requiresLot: true,
          requiresExpiry: true,
          ...(balanceLocationIds.length > 0
            ? {
                stockBalances: {
                  where: { locationId: { in: balanceLocationIds } },
                  select: { onHandQty: true, reservedQty: true, locationId: true },
                },
              }
            : {}),
        },
      },
    },
  });

  const catalogTruncated = products.length > MAX_STOCK_REQUEST_PICKER_PRODUCTS;
  const cappedProducts = catalogTruncated ? products.slice(0, MAX_STOCK_REQUEST_PICKER_PRODUCTS) : products;
  const branchLocSet = new Set(branchLocationIds);
  const centralLocSet = new Set(centralLocationIds);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const variantIds = cappedProducts.flatMap((p) => p.variants.map((v) => v.id));

  const usageData =
    variantIds.length > 0
      ? await prisma.stockRequestItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { in: variantIds },
            stockRequest: {
              branchId: options.branchId,
              createdAt: { gte: thirtyDaysAgo },
              status: { notIn: ["CANCELLED"] },
            },
          },
          _sum: { requestedQty: true },
        })
      : [];
  const usageMap = new Map(usageData.map((u) => [u.variantId, u._sum.requestedQty ?? 0]));

  const lotRequiredVariantIds = cappedProducts
    .flatMap((p) => p.variants.filter((v) => v.requiresLot || v.requiresExpiry))
    .map((v) => v.id);

  let batchDataMap = new Map<number, { activeLots: number; nearestExpiry: Date | null; nearExpiryQty: number; expiredQty: number }>();
  if (lotRequiredVariantIds.length > 0 && branchLocationIds.length > 0) {
    const now = new Date();
    const nearExpiryThreshold = new Date(now);
    nearExpiryThreshold.setDate(nearExpiryThreshold.getDate() + 30);

    const lotBalances = await prisma.stockLotBalance.findMany({
      where: {
        locationId: { in: branchLocationIds },
        onHandQty: { gt: 0 },
        lot: { variantId: { in: lotRequiredVariantIds } },
      },
      include: {
        lot: { select: { variantId: true, expDate: true } },
      },
    });

    const batchAgg: Record<
      number,
      { lots: Set<number>; nearestExpiry: Date | null; nearExpiryQty: number; expiredQty: number }
    > = {};
    for (const lb of lotBalances) {
      const vid = lb.lot.variantId;
      if (!batchAgg[vid]) batchAgg[vid] = { lots: new Set(), nearestExpiry: null, nearExpiryQty: 0, expiredQty: 0 };
      batchAgg[vid].lots.add(lb.lotId);
      const exp = lb.lot.expDate;
      if (exp < now) batchAgg[vid].expiredQty += lb.onHandQty;
      else if (exp <= nearExpiryThreshold) batchAgg[vid].nearExpiryQty += lb.onHandQty;
      if (!batchAgg[vid].nearestExpiry || exp < batchAgg[vid].nearestExpiry) batchAgg[vid].nearestExpiry = exp;
    }

    batchDataMap = new Map(
      Object.entries(batchAgg).map(([vid, data]) => [
        parseInt(vid, 10),
        {
          activeLots: data.lots.size,
          nearestExpiry: data.nearestExpiry,
          nearExpiryQty: data.nearExpiryQty,
          expiredQty: data.expiredQty,
        },
      ])
    );
  }

  const items = cappedProducts
    .map((p) => {
      const variants = p.variants.map((v) => {
        const balances = Array.isArray(v.stockBalances) ? v.stockBalances : [];
        let stockOnHand = 0;
        let reservedQty = 0;
        let centralOnHand = 0;
        for (const b of balances) {
          if (branchLocSet.has(b.locationId)) {
            stockOnHand += b.onHandQty;
            reservedQty += b.reservedQty;
          } else if (centralLocSet.has(b.locationId)) {
            centralOnHand += b.onHandQty;
          }
        }
        const availableQty = stockOnHand - reservedQty;
        const usageMetric = usageMap.get(v.id) ?? 0;
        const batchData = batchDataMap.get(v.id);

        return {
          id: v.id,
          sku: v.sku,
          title: v.title,
          barcode: v.barcode,
          productId: v.productId,
          stockOnHand,
          centralOnHand,
          availableQty,
          reservedQty,
          lowStockThreshold: 10,
          usageMetric,
          ...(batchData && {
            batchInfo: {
              activeLots: batchData.activeLots,
              nearestExpiry: batchData.nearestExpiry,
              nearExpiryQty: batchData.nearExpiryQty,
              expiredQty: batchData.expiredQty,
            },
          }),
        };
      });
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        brand: p.brand,
        variants,
      };
    })
    .filter((p) => p.variants.length > 0);

  let filteredItems = items;
  if (options.stockStatus === "low") {
    filteredItems = items.filter((p) =>
      p.variants.some((v) => v.stockOnHand > 0 && v.stockOnHand <= v.lowStockThreshold)
    );
  } else if (options.stockStatus === "out") {
    filteredItems = items.filter((p) => p.variants.every((v) => v.stockOnHand === 0));
  }

  if (options.sort === "low_stock") {
    filteredItems.sort((a, b) => {
      const aMin = Math.min(...a.variants.map((v) => v.stockOnHand));
      const bMin = Math.min(...b.variants.map((v) => v.stockOnHand));
      return aMin - bMin;
    });
  } else if (options.sort === "most_used") {
    filteredItems.sort((a, b) => {
      const aMax = Math.max(...a.variants.map((v) => v.usageMetric));
      const bMax = Math.max(...b.variants.map((v) => v.usageMetric));
      return bMax - aMax;
    });
  } else if (options.sort === "name_asc") {
    filteredItems.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filteredItems.sort((a, b) => {
      const aMin = Math.min(...a.variants.map((v) => v.stockOnHand));
      const bMin = Math.min(...b.variants.map((v) => v.stockOnHand));
      if (aMin !== bMin) return aMin - bMin;
      return a.name.localeCompare(b.name);
    });
  }

  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * limit;
  const pageItems = filteredItems.slice(skip, skip + limit);

  return {
    items: pageItems,
    pagination: { page: safePage, limit, total, totalPages },
    meta: {
      pickerRule: STOCK_REQUEST_PICKER_RULE,
      branchLocalLocationCount: branchLocationIds.length,
      centralLocationCount: centralLocationIds.length,
      defaultLocationCreated,
      catalogTruncated,
      rawProductCount: Math.min(rawCount, MAX_STOCK_REQUEST_PICKER_PRODUCTS + (catalogTruncated ? 1 : 0)),
    },
  };
}

const EXTRA_PICKER_MAX_CANDIDATES = 4000;
const EXTRA_PICKER_ENRICH_BATCH = 48;

async function loadRawLotOnHandMap(
  orgId: number,
  locationId: number,
  variantIds: number[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!variantIds.length) return map;
  const rawRows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: { orgId, variantId: { in: variantIds } },
    },
    select: { onHandQty: true, lot: { select: { variantId: true } } },
  });
  for (const r of rawRows) {
    const vid = r.lot.variantId;
    map.set(vid, (map.get(vid) ?? 0) + r.onHandQty);
  }
  return map;
}

/**
 * Owner fulfill extra-item picker: variants with stock signals at fromLocationId,
 * quantities via same FEFO / non-lot helpers as fulfill validation.
 */
async function getStockRequestExtraPicker(options: {
  stockRequestId: number;
  fromLocationId: number;
  userId: number;
  search?: string;
  page?: number;
  limit?: number;
  includeZeroStock?: boolean;
}) {
  const stockRequestId = options.stockRequestId;
  const fromLocationId = options.fromLocationId;
  const userId = options.userId;
  const search = (options.search || "").trim();
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const includeZeroStock = Boolean(options.includeZeroStock);

  const sr = await prisma.stockRequest.findUnique({
    where: { id: stockRequestId },
    select: { orgId: true, branchId: true },
  });
  if (!sr) {
    const err = new Error("Stock request not found") as Error & { code?: string };
    err.code = "NOT_FOUND";
    throw err;
  }

  const ownedRows = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    take: 1,
    select: { id: true },
  });
  const ownedOrg = ownedRows[0];
  const managed = await getManagedBranchesForUser(userId);
  const canAccess =
    ownedOrg?.id === sr.orgId ||
    managed.some((b: { branchId: number }) => b.branchId === sr.branchId);
  if (!canAccess) {
    const err = new Error("Not authorized for this stock request") as Error & { code?: string };
    err.code = "FORBIDDEN";
    throw err;
  }

  const locOrg = await resolveOrgIdForLocation(fromLocationId);
  if (locOrg == null || locOrg !== sr.orgId) {
    const err = new Error(
      "Source location must belong to the same organization as the stock request"
    ) as Error & { code?: string };
    err.code = "FORBIDDEN";
    throw err;
  }

  const orgId = sr.orgId;

  const books = await prisma.stockBalance.findMany({
    where: { locationId: fromLocationId },
    select: { variantId: true, onHandQty: true, reservedQty: true },
  });
  const fromBook = new Set<number>();
  for (const b of books) {
    if (b.onHandQty - (b.reservedQty ?? 0) > 0) fromBook.add(b.variantId);
  }

  const lotRows = await prisma.stockLotBalance.findMany({
    where: { locationId: fromLocationId, onHandQty: { gt: 0 } },
    include: { lot: { select: { variantId: true, orgId: true } } },
  });
  const fromLot = new Set<number>();
  for (const lb of lotRows) {
    if (lb.lot.orgId === orgId) fromLot.add(lb.lot.variantId);
  }

  const candidateIds = [...new Set([...fromBook, ...fromLot])];
  const candidateTruncated = candidateIds.length > EXTRA_PICKER_MAX_CANDIDATES;
  const cappedCandidateIds = candidateTruncated
    ? candidateIds.slice(0, EXTRA_PICKER_MAX_CANDIDATES)
    : candidateIds;

  if (cappedCandidateIds.length === 0) {
    return {
      items: [] as Array<Record<string, unknown>>,
      pagination: { page: 1, limit, total: 0, totalPages: 1 },
      meta: {
        candidateVariantCount: 0,
        matchedVariantCount: 0,
        candidateTruncated: false,
      },
    };
  }

  const searchOr =
    search.length > 0
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search, mode: "insensitive" } },
            { product: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : undefined;

  const CHUNK = 800;
  const variants: Array<{
    id: number;
    title: string;
    sku: string;
    productId: number;
    product: { id: number; name: string } | null;
  }> = [];
  const seen = new Set<number>();
  for (let i = 0; i < cappedCandidateIds.length; i += CHUNK) {
    const chunk = cappedCandidateIds.slice(i, i + CHUNK);
    const part = await prisma.productVariant.findMany({
      where: {
        id: { in: chunk },
        isActive: true,
        ...(searchOr ? searchOr : {}),
      },
      select: {
        id: true,
        title: true,
        sku: true,
        productId: true,
        product: { select: { id: true, name: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { id: "asc" }],
    });
    for (const v of part) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        variants.push(v);
      }
    }
  }

  variants.sort((a, b) => {
    const an = a.product?.name ?? "";
    const bn = b.product?.name ?? "";
    const c = an.localeCompare(bn);
    if (c !== 0) return c;
    return a.id - b.id;
  });

  type Enriched = {
    productId: number;
    productName: string;
    variantId: number;
    variantLabel: string;
    bookQty: number;
    lotFefoQty: number;
    maxDispatchable: number;
    availableQty: number;
  };

  const enriched: Enriched[] = [];
  for (let i = 0; i < variants.length; i += EXTRA_PICKER_ENRICH_BATCH) {
    const slice = variants.slice(i, i + EXTRA_PICKER_ENRICH_BATCH);
    const batchRows = await Promise.all(
      slice.map(async (v) => {
        const [bookQty, lotFefoQty] = await Promise.all([
          getNonLotEffectiveAtLocation(fromLocationId, v.id),
          getFefoEligibleLotTotal(orgId, fromLocationId, v.id),
        ]);
        // Same definition as getMaxDispatchableQtyAtLocation (stock request fulfill / GET detail).
        const maxDispatchable = Math.max(bookQty, lotFefoQty);
        return {
          productId: v.productId,
          productName: v.product?.name ?? "",
          variantId: v.id,
          variantLabel: v.title || v.sku || String(v.id),
          bookQty,
          lotFefoQty,
          maxDispatchable,
          availableQty: maxDispatchable,
        };
      })
    );
    enriched.push(...batchRows);
  }

  let filtered = includeZeroStock ? enriched : enriched.filter((r) => r.maxDispatchable > 0);
  filtered.sort((a, b) => {
    if (b.maxDispatchable !== a.maxDispatchable) return b.maxDispatchable - a.maxDispatchable;
    const pn = a.productName.localeCompare(b.productName);
    if (pn !== 0) return pn;
    return a.variantId - b.variantId;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * limit, safePage * limit);

  const pageIds = pageItems.map((r) => r.variantId);
  const rawMap = await loadRawLotOnHandMap(orgId, fromLocationId, pageIds);

  const items = pageItems.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    variantId: r.variantId,
    variantLabel: r.variantLabel,
    bookQty: r.bookQty,
    lotFefoQty: r.lotFefoQty,
    maxDispatchable: r.maxDispatchable,
    availableQty: r.availableQty,
    rawLotOnHandQty: rawMap.get(r.variantId) ?? 0,
  }));

  return {
    items,
    pagination: { page: safePage, limit, total, totalPages },
    meta: {
      candidateVariantCount: candidateIds.length,
      matchedVariantCount: variants.length,
      candidateTruncated,
    },
  };
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
  getInventoryBatches,
  userCanAccessOrgForLocations,
  getInventoryLocations,
  getExpiringItemsV2,
  getLowStockAlertsV2,
  getStockBalanceReport,
  getStockByLotExpiryReport,
  getVariantsSearch,
  getValuation,
  getInventoryDashboardCards,
  getStockRequestProducts,
  getStockRequestExtraPicker,
};

export {};
