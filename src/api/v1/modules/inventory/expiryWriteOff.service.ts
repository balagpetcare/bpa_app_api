import prisma from "../../../../infrastructure/db/prismaClient";
import * as ledgerService from "./ledger.service";

/**
 * Expiry Write-Off Service
 * Handles automatic and manual write-off of expired stock with audit trail
 */

interface ScanAndWriteOffResult {
  writtenOffCount: number;
  totalQuantity: number;
  items: Array<{
    lotId: number;
    lotCode: string;
    variantId: number;
    productName: string;
    locationId: number;
    locationName: string;
    quantity: number;
    expDate: Date;
    ledgerId?: number;
    writeOffLogId?: number;
  }>;
}

/**
 * Scan for expired stock and write off automatically or in dry-run mode
 */
export async function scanAndWriteOffExpired(params: {
  orgId: number;
  locationId?: number;
  dryRun?: boolean;
  userId?: number;
}): Promise<ScanAndWriteOffResult> {
  const now = new Date();

  // Query expired lot balances with positive quantity
  const where: any = {
    onHandQty: { gt: 0 },
    lot: {
      expDate: { lt: now },
    },
  };

  if (params.locationId) {
    where.locationId = params.locationId;
  } else {
    // Filter by org if no specific location
    where.location = {
      branch: {
        orgId: params.orgId,
      },
    };
  }

  const expiredLotBalances = await prisma.stockLotBalance.findMany({
    where,
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          variantId: true,
          variant: {
            select: {
              id: true,
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
      location: {
        select: {
          id: true,
          name: true,
          branchId: true,
        },
      },
    },
  });

  if (params.dryRun) {
    // Return what would be written off without doing it
    return {
      writtenOffCount: expiredLotBalances.length,
      totalQuantity: expiredLotBalances.reduce((sum, lb) => sum + lb.onHandQty, 0),
      items: expiredLotBalances.map((lb) => ({
        lotId: lb.lotId,
        lotCode: lb.lot.lotCode,
        variantId: lb.lot.variantId,
        productName: lb.lot.variant?.product?.name || "Unknown",
        locationId: lb.locationId,
        locationName: lb.location.name,
        quantity: lb.onHandQty,
        expDate: lb.lot.expDate,
      })),
    };
  }

  // Perform actual write-offs
  const items: ScanAndWriteOffResult["items"] = [];

  for (const lb of expiredLotBalances) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Create EXPIRED ledger entry
        const ledgerEntry = await tx.stockLedger.create({
          data: {
            orgId: params.orgId,
            locationId: lb.locationId,
            variantId: lb.lot.variantId,
            lotId: lb.lotId,
            type: "EXPIRED",
            quantityDelta: -lb.onHandQty,
            refType: "AUTO_WRITEOFF",
            refId: `AUTO_${Date.now()}`,
            createdByUserId: params.userId || null,
          },
        });

        // Update lot balance to zero
        await tx.stockLotBalance.update({
          where: {
            locationId_lotId: {
              locationId: lb.locationId,
              lotId: lb.lotId,
            },
          },
          data: {
            onHandQty: 0,
          },
        });

        // Update aggregated balance
        const existingBalance = await tx.stockBalance.findUnique({
          where: {
            locationId_variantId: {
              locationId: lb.locationId,
              variantId: lb.lot.variantId,
            },
          },
        });

        if (existingBalance) {
          const newOnHand = existingBalance.onHandQty - lb.onHandQty;
          await tx.stockBalance.update({
            where: {
              locationId_variantId: {
                locationId: lb.locationId,
                variantId: lb.lot.variantId,
              },
            },
            data: {
              onHandQty: newOnHand >= 0 ? newOnHand : 0,
            },
          });
        }

        // Create write-off log
        const writeOffLog = await tx.expiryWriteOffLog.create({
          data: {
            orgId: params.orgId,
            locationId: lb.locationId,
            lotId: lb.lotId,
            variantId: lb.lot.variantId,
            quantity: lb.onHandQty,
            ledgerId: ledgerEntry.id,
            method: "AUTO",
            createdById: params.userId || null,
          },
        });

        return {
          ledgerId: ledgerEntry.id,
          writeOffLogId: writeOffLog.id,
        };
      });

      items.push({
        lotId: lb.lotId,
        lotCode: lb.lot.lotCode,
        variantId: lb.lot.variantId,
        productName: lb.lot.variant?.product?.name || "Unknown",
        locationId: lb.locationId,
        locationName: lb.location.name,
        quantity: lb.onHandQty,
        expDate: lb.lot.expDate,
        ledgerId: result.ledgerId,
        writeOffLogId: result.writeOffLogId,
      });
    } catch (error: any) {
      console.error(`Failed to write off lot ${lb.lot.lotCode}:`, error.message);
      // Continue with next lot
    }
  }

  return {
    writtenOffCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
}

/**
 * Get currently expired stock not yet written off
 */
export async function getExpiredStockSummary(params: {
  orgId: number;
  locationId?: number;
  branchId?: number;
}) {
  const now = new Date();

  const where: any = {
    onHandQty: { gt: 0 },
    lot: {
      expDate: { lt: now },
    },
  };

  if (params.locationId) {
    where.locationId = params.locationId;
  } else if (params.branchId) {
    where.location = { branchId: params.branchId };
  } else {
    where.location = { branch: { orgId: params.orgId } };
  }

  const expiredLotBalances = await prisma.stockLotBalance.findMany({
    where,
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          variantId: true,
          variant: {
            select: {
              id: true,
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      location: {
        select: {
          id: true,
          name: true,
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      lot: {
        expDate: "asc",
      },
    },
  });

  const items = expiredLotBalances.map((lb) => {
    const daysExpired = Math.floor(
      (now.getTime() - lb.lot.expDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      lotId: lb.lotId,
      lotCode: lb.lot.lotCode,
      variantId: lb.lot.variantId,
      productName: lb.lot.variant?.product?.name || "Unknown",
      productId: lb.lot.variant?.product?.id,
      locationId: lb.locationId,
      locationName: lb.location.name,
      branchId: lb.location.branchId,
      branchName: lb.location.branch?.name,
      onHandQty: lb.onHandQty,
      expDate: lb.lot.expDate,
      daysExpired,
    };
  });

  return {
    items,
    totalExpiredQty: items.reduce((sum, item) => sum + item.onHandQty, 0),
    totalExpiredLots: items.length,
  };
}

/**
 * Manual write-off of expired stock (partial or full)
 */
export async function manualWriteOff(params: {
  lotId: number;
  locationId: number;
  quantity: number;
  reason?: string;
  userId: number;
}) {
  // Validate lot exists and is expired
  const lot = await prisma.stockLot.findUnique({
    where: { id: params.lotId },
    select: { id: true, lotCode: true, expDate: true, variantId: true, orgId: true },
  });

  if (!lot) {
    throw new Error("Lot not found");
  }

  if (lot.expDate >= new Date()) {
    throw new Error(`Lot ${lot.lotCode} has not expired yet`);
  }

  // Check available quantity
  const lotBalance = await prisma.stockLotBalance.findUnique({
    where: {
      locationId_lotId: {
        locationId: params.locationId,
        lotId: params.lotId,
      },
    },
  });

  if (!lotBalance) {
    throw new Error("No stock found at this location for the specified lot");
  }

  if (lotBalance.onHandQty < params.quantity) {
    throw new Error(
      `Insufficient stock. Available: ${lotBalance.onHandQty}, Requested: ${params.quantity}`
    );
  }

  // Perform write-off in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create EXPIRED ledger entry
    const ledgerEntry = await tx.stockLedger.create({
      data: {
        orgId: lot.orgId,
        locationId: params.locationId,
        variantId: lot.variantId,
        lotId: params.lotId,
        type: "EXPIRED",
        quantityDelta: -params.quantity,
        refType: "MANUAL_WRITEOFF",
        refId: params.reason || "Manual write-off",
        createdByUserId: params.userId,
      },
    });

    // Update lot balance
    const newOnHand = lotBalance.onHandQty - params.quantity;
    await tx.stockLotBalance.update({
      where: {
        locationId_lotId: {
          locationId: params.locationId,
          lotId: params.lotId,
        },
      },
      data: {
        onHandQty: newOnHand,
      },
    });

    // Update aggregated balance
    const existingBalance = await tx.stockBalance.findUnique({
      where: {
        locationId_variantId: {
          locationId: params.locationId,
          variantId: lot.variantId,
        },
      },
    });

    if (existingBalance) {
      await tx.stockBalance.update({
        where: {
          locationId_variantId: {
            locationId: params.locationId,
            variantId: lot.variantId,
          },
        },
        data: {
          onHandQty: existingBalance.onHandQty - params.quantity,
        },
      });
    }

    // Create write-off log
    const writeOffLog = await tx.expiryWriteOffLog.create({
      data: {
        orgId: lot.orgId,
        locationId: params.locationId,
        lotId: params.lotId,
        variantId: lot.variantId,
        quantity: params.quantity,
        ledgerId: ledgerEntry.id,
        method: "MANUAL",
        createdById: params.userId,
      },
    });

    return {
      ledgerId: ledgerEntry.id,
      writeOffLogId: writeOffLog.id,
      remainingQty: newOnHand,
    };
  });

  return result;
}

/**
 * Get write-off history log with filters
 */
export async function getWriteOffLog(params: {
  orgId: number;
  locationId?: number;
  lotId?: number;
  method?: "AUTO" | "MANUAL";
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {
    orgId: params.orgId,
  };

  if (params.locationId) where.locationId = params.locationId;
  if (params.lotId) where.lotId = params.lotId;
  if (params.method) where.method = params.method;
  if (params.startDate) {
    where.createdAt = { ...where.createdAt, gte: params.startDate };
  }
  if (params.endDate) {
    where.createdAt = { ...where.createdAt, lte: params.endDate };
  }

  const [items, total] = await Promise.all([
    prisma.expiryWriteOffLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        lot: {
          select: {
            id: true,
            lotCode: true,
            expDate: true,
          },
        },
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
        location: {
          select: {
            id: true,
            name: true,
            branchId: true,
            branch: {
              select: {
                id: true,
                name: true,
              },
            },
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
      },
    }),
    prisma.expiryWriteOffLog.count({ where }),
  ]);

  return {
    items: items.map((log) => ({
      id: log.id,
      lotId: log.lotId,
      lotCode: log.lot.lotCode,
      expDate: log.lot.expDate,
      variantId: log.variantId,
      productName: log.variant?.product?.name || "Unknown",
      locationId: log.locationId,
      locationName: log.location.name,
      branchId: log.location.branchId,
      branchName: log.location.branch?.name,
      quantity: log.quantity,
      method: log.method,
      createdBy: log.createdBy
        ? {
            id: log.createdBy.id,
            name: log.createdBy.profile?.displayName || "User",
          }
        : null,
      createdAt: log.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  scanAndWriteOffExpired,
  getExpiredStockSummary,
  manualWriteOff,
  getWriteOffLog,
};

export {};
