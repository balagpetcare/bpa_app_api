import prisma from "../../../../infrastructure/db/prismaClient";
const inventoryService = require("./inventory.service");

/**
 * Pharmacy Dashboard Service
 * Provides consolidated metrics for pharmacy operations including stock value,
 * expiry alerts, recalls, and requisition pipeline
 */

interface PharmacyDashboardMetrics {
  totalStockValue: number;
  totalSKUs: number;
  expiredCount: number;
  nearExpiry: {
    days30: number;
    days60: number;
    days90: number;
  };
  activeRecalls: number;
  lowStockCount: number;
  pendingRequisitions: number;
  transferPipeline: {
    inTransit: number;
    pendingReceive: number;
  };
  recentWriteOffs: {
    last7Days: number;
    totalQty: number;
  };
}

/**
 * Get consolidated pharmacy dashboard metrics
 */
export async function getPharmacyDashboard(params: {
  orgId: number;
  branchId?: number;
}): Promise<PharmacyDashboardMetrics> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyDaysAhead = new Date(now);
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

  const sixtyDaysAhead = new Date(now);
  sixtyDaysAhead.setDate(sixtyDaysAhead.getDate() + 60);

  const ninetyDaysAhead = new Date(now);
  ninetyDaysAhead.setDate(ninetyDaysAhead.getDate() + 90);

  // Build location filter
  const locationFilter: any = params.branchId
    ? { branchId: params.branchId }
    : { branch: { orgId: params.orgId } };

  // Build org filter
  const orgFilter: any = {
    orgId: params.orgId,
  };

  // Execute all queries in parallel
  const [
    totalStockValue,
    totalSKUs,
    expiredCount,
    nearExpiry30,
    nearExpiry60,
    nearExpiry90,
    activeRecalls,
    lowStockCount,
    pendingRequisitions,
    transfersInTransit,
    transfersPendingReceive,
    recentWriteOffs,
  ] = await Promise.all([
    // Total stock value (using valuation from existing service)
    (async () => {
      try {
        // Get all locations for the org/branch
        const locations = await prisma.inventoryLocation.findMany({
          where: locationFilter,
          select: { id: true },
        });

        if (locations.length === 0) return 0;

        // Sum valuations across all locations
        let totalValue = 0;
        for (const loc of locations) {
          const valuation = await inventoryService.getValuation({
            locationId: loc.id,
            method: "WEIGHTED_AVG",
          });
          totalValue += valuation.totalValue || 0;
        }
        return totalValue;
      } catch (error) {
        console.error("Error calculating total stock value:", error);
        return 0;
      }
    })(),

    // Total SKUs with stock
    prisma.stockBalance.count({
      where: {
        onHandQty: { gt: 0 },
        location: locationFilter,
      },
    }),

    // Expired count
    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: { lt: now },
        },
        location: locationFilter,
      },
    }),

    // Near expiry counts
    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: {
            gte: now,
            lte: thirtyDaysAhead,
          },
        },
        location: locationFilter,
      },
    }),

    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: {
            gt: thirtyDaysAhead,
            lte: sixtyDaysAhead,
          },
        },
        location: locationFilter,
      },
    }),

    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: {
            gt: sixtyDaysAhead,
            lte: ninetyDaysAhead,
          },
        },
        location: locationFilter,
      },
    }),

    // Active recalls
    prisma.batchRecall.count({
      where: {
        ...orgFilter,
        status: "ACTIVE",
      },
    }),

    // Low stock count (using existing alerts function)
    (async () => {
      try {
        const alerts = await inventoryService.getLowStockAlertsV2({
          ...(params.branchId ? { branchId: params.branchId } : {}),
        });
        return alerts.length;
      } catch (error) {
        console.error("Error getting low stock count:", error);
        return 0;
      }
    })(),

    // Pending requisitions (submitted, under review, or approved but not dispatched)
    prisma.medicineRequisition.count({
      where: {
        ...orgFilter,
        ...(params.branchId ? { branchId: params.branchId } : {}),
        status: {
          in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PARTIALLY_APPROVED"],
        },
      },
    }),

    // Transfers in transit
    prisma.stockTransfer.count({
      where: {
        status: "IN_TRANSIT",
        ...(params.branchId
          ? {
              OR: [
                { fromLocation: { branchId: params.branchId } },
                { toLocation: { branchId: params.branchId } },
              ],
            }
          : {
              OR: [
                { fromLocation: { branch: { orgId: params.orgId } } },
                { toLocation: { branch: { orgId: params.orgId } } },
              ],
            }),
      },
    }),

    // Transfers pending receive
    prisma.stockTransfer.count({
      where: {
        status: "SENT",
        ...(params.branchId
          ? {
              OR: [
                { fromLocation: { branchId: params.branchId } },
                { toLocation: { branchId: params.branchId } },
              ],
            }
          : {
              OR: [
                { fromLocation: { branch: { orgId: params.orgId } } },
                { toLocation: { branch: { orgId: params.orgId } } },
              ],
            }),
      },
    }),

    // Recent write-offs (last 7 days)
    prisma.expiryWriteOffLog.aggregate({
      where: {
        ...orgFilter,
        ...(params.branchId ? { location: { branchId: params.branchId } } : {}),
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      _count: { id: true },
      _sum: { quantity: true },
    }),
  ]);

  return {
    totalStockValue: Number(totalStockValue.toFixed(2)),
    totalSKUs,
    expiredCount,
    nearExpiry: {
      days30: nearExpiry30,
      days60: nearExpiry60,
      days90: nearExpiry90,
    },
    activeRecalls,
    lowStockCount,
    pendingRequisitions,
    transferPipeline: {
      inTransit: transfersInTransit,
      pendingReceive: transfersPendingReceive,
    },
    recentWriteOffs: {
      last7Days: recentWriteOffs._count.id || 0,
      totalQty: recentWriteOffs._sum.quantity || 0,
    },
  };
}

/**
 * Get expiry trend (monthly expired qty for chart)
 */
export async function getExpiryTrend(params: {
  orgId: number;
  months: number; // Number of months to go back
}) {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - params.months);
  startDate.setDate(1); // Start from first day of month
  startDate.setHours(0, 0, 0, 0);

  // Get write-off logs grouped by month
  const writeOffLogs = await prisma.expiryWriteOffLog.findMany({
    where: {
      orgId: params.orgId,
      createdAt: {
        gte: startDate,
      },
    },
    select: {
      quantity: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // Group by month
  const monthlyData: Record<
    string,
    { expiredQty: number; writeOffCount: number }
  > = {};

  for (const log of writeOffLogs) {
    const monthKey = `${log.createdAt.getFullYear()}-${String(
      log.createdAt.getMonth() + 1
    ).padStart(2, "0")}`;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { expiredQty: 0, writeOffCount: 0 };
    }

    monthlyData[monthKey].expiredQty += log.quantity;
    monthlyData[monthKey].writeOffCount += 1;
  }

  // Fill in missing months with zeros
  const result: Array<{
    month: string;
    expiredQty: number;
    writeOffCount: number;
  }> = [];

  for (let i = 0; i < params.months; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;

    result.unshift({
      month: monthKey,
      expiredQty: monthlyData[monthKey]?.expiredQty || 0,
      writeOffCount: monthlyData[monthKey]?.writeOffCount || 0,
    });
  }

  return result;
}

/**
 * Get pharmacy alert summary (for notification/badge counts)
 */
export async function getPharmacyAlerts(params: {
  orgId: number;
  branchId?: number;
}) {
  const now = new Date();
  const sevenDaysAhead = new Date(now);
  sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);

  const locationFilter: any = params.branchId
    ? { branchId: params.branchId }
    : { branch: { orgId: params.orgId } };

  const [
    expiredCount,
    expiringIn7Days,
    criticalRecalls,
    urgentRecalls,
    lowStockCount,
  ] = await Promise.all([
    // Expired stock
    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: { lt: now },
        },
        location: locationFilter,
      },
    }),

    // Expiring in 7 days
    prisma.stockLotBalance.count({
      where: {
        onHandQty: { gt: 0 },
        lot: {
          expDate: {
            gte: now,
            lte: sevenDaysAhead,
          },
        },
        location: locationFilter,
      },
    }),

    // Critical recalls
    prisma.batchRecall.count({
      where: {
        orgId: params.orgId,
        status: "ACTIVE",
        severity: "CRITICAL",
      },
    }),

    // Urgent recalls
    prisma.batchRecall.count({
      where: {
        orgId: params.orgId,
        status: "ACTIVE",
        severity: "URGENT",
      },
    }),

    // Low stock (using hardcoded threshold for now)
    prisma.stockBalance.count({
      where: {
        onHandQty: { lte: 10 },
        location: locationFilter,
      },
    }),
  ]);

  return {
    expired: expiredCount,
    expiringIn7Days,
    criticalRecalls,
    urgentRecalls,
    lowStock: lowStockCount,
    totalAlerts:
      expiredCount +
      expiringIn7Days +
      criticalRecalls +
      urgentRecalls +
      lowStockCount,
  };
}

module.exports = {
  getPharmacyDashboard,
  getExpiryTrend,
  getPharmacyAlerts,
};

export {};
