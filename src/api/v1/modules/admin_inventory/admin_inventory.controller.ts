const prisma = require('../../../../infrastructure/db/prismaClient');

/**
 * Admin inventory summary - ledger-based (StockBalance)
 */
exports.getSummary = async (req, res) => {
  try {
    const [totalItems, lowStock, outOfStock, balances] = await Promise.all([
      prisma.stockBalance.count().catch(() => 0),
      prisma.stockBalance.count({
        where: { onHandQty: { lte: 10, gt: 0 } },
      }).catch(() => 0),
      prisma.stockBalance.count({
        where: { onHandQty: 0 },
      }).catch(() => 0),
      prisma.stockBalance.findMany({
        take: 1000,
        include: {
          location: {
            select: { id: true, name: true },
            include: { branch: { select: { id: true, name: true } } },
          },
          variant: {
            select: { id: true, sku: true, title: true },
            include: { product: { select: { id: true, name: true } } },
          },
        },
      }).catch(() => []),
    ]);

    const items = balances.map((b) => ({
      id: `loc-${b.locationId}-var-${b.variantId}`,
      quantity: b.onHandQty,
      product: b.variant?.product,
      variant: b.variant,
      branch: b.location?.branch,
    }));

    return res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          lowStockCount: lowStock,
          outOfStockCount: outOfStock,
          totalValue: 0,
        },
        items,
      },
    });
  } catch (e) {
    console.error('admin inventory summary error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

/**
 * Admin inventory alerts - ledger-based
 */
exports.getAlerts = async (req, res) => {
  try {
    const [lowStock, outOfStock] = await Promise.all([
      prisma.stockBalance.findMany({
        where: { onHandQty: { lte: 10, gt: 0 } },
        include: {
          location: { include: { branch: { select: { id: true, name: true } } } },
          variant: {
            select: { id: true, sku: true },
            include: { product: { select: { id: true, name: true } } },
          },
        },
        orderBy: { onHandQty: 'asc' },
        take: 100,
      }).catch(() => []),
      prisma.stockBalance.findMany({
        where: { onHandQty: 0 },
        include: {
          location: { include: { branch: { select: { id: true, name: true } } } },
          variant: {
            select: { id: true, sku: true },
            include: { product: { select: { id: true, name: true } } },
          },
        },
        take: 100,
      }).catch(() => []),
    ]);

    return res.json({
      success: true,
      data: {
        lowStock: lowStock.map((b) => ({
          quantity: b.onHandQty,
          product: b.variant?.product,
          variant: b.variant,
          branch: b.location?.branch,
        })),
        outOfStock: outOfStock.map((b) => ({
          quantity: 0,
          product: b.variant?.product,
          variant: b.variant,
          branch: b.location?.branch,
        })),
      },
    });
  } catch (e) {
    console.error('admin inventory alerts error', e);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export {};
