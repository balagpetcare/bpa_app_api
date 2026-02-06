const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Get sales report
 */
async function getSalesReport(options: {
  orgId?: number;
  branchId?: number;
  startDate?: Date;
  endDate?: Date;
  groupBy?: "day" | "week" | "month";
}) {
  const where: any = {};

  if (options.branchId) {
    where.branchId = options.branchId;
  } else if (options.orgId) {
    where.branch = {
      orgId: options.orgId,
    };
  }

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      where.createdAt.gte = options.startDate;
    }
    if (options.endDate) {
      where.createdAt.lte = options.endDate;
    }
  }

  // Get orders with items
  const orders = await prisma.order.findMany({
    where: {
      ...where,
      status: { not: "CANCELLED" },
      paymentStatus: "COMPLETED",
    },
    include: {
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate totals
  const totalSales = orders.reduce((sum, order) => sum + parseFloat(order.totalAmount.toString()), 0);
  const totalOrders = orders.length;
  const totalItems = orders.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0);
  }, 0);

  // Group by date if needed
  let groupedData = {};
  if (options.groupBy) {
    orders.forEach((order) => {
      const date = new Date(order.createdAt);
      let key = "";

      if (options.groupBy === "day") {
        key = date.toISOString().split("T")[0];
      } else if (options.groupBy === "week") {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0];
      } else if (options.groupBy === "month") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          date: key,
          sales: 0,
          orders: 0,
          items: 0,
        };
      }

      groupedData[key].sales += parseFloat(order.totalAmount.toString());
      groupedData[key].orders += 1;
      groupedData[key].items += order.items.reduce((sum, item) => sum + item.quantity, 0);
    });
  }

  return {
    summary: {
      totalSales,
      totalOrders,
      totalItems,
      averageOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
    },
    orders: orders,
    grouped: options.groupBy ? Object.values(groupedData) : null,
  };
}

/**
 * Get top selling products
 */
async function getTopSellingProducts(options: {
  orgId?: number;
  branchId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const where: any = {
    order: {
      status: { not: "CANCELLED" },
      paymentStatus: "COMPLETED",
    },
  };

  if (options.branchId) {
    where.order.branchId = options.branchId;
  } else if (options.orgId) {
    where.order.branch = {
      orgId: options.orgId,
    };
  }

  if (options.startDate || options.endDate) {
    where.order.createdAt = {};
    if (options.startDate) {
      where.order.createdAt.gte = options.startDate;
    }
    if (options.endDate) {
      where.order.createdAt.lte = options.endDate;
    }
  }

  const orderItems = await prisma.orderItem.findMany({
    where,
    include: {
      product: true,
      variant: true,
      order: {
        select: {
          branch: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  // Group by product
  const productMap = new Map();

  orderItems.forEach((item) => {
    const key = item.variantId ? `${item.productId}-${item.variantId}` : `${item.productId}`;
    
    if (!productMap.has(key)) {
      productMap.set(key, {
        productId: item.productId,
        productName: item.product.name,
        variantId: item.variantId,
        variantName: item.variant?.title || "Standard",
        totalQuantity: 0,
        totalRevenue: 0,
        orderCount: 0,
      });
    }

    const product = productMap.get(key);
    product.totalQuantity += item.quantity;
    product.totalRevenue += parseFloat(item.total.toString());
    product.orderCount += 1;
  });

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, options.limit || 10);

  return topProducts;
}

/**
 * Get zero sales products (last N months)
 */
async function getZeroSalesProducts(options: {
  orgId?: number;
  branchId?: number;
  months?: number;
}) {
  const months = options.months || 3;
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);

  const where: any = {
    status: "ACTIVE",
  };

  if (options.orgId) {
    where.orgId = options.orgId;
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      variants: {
        where: { isActive: true },
      },
      orderItems: {
        where: {
          order: {
            createdAt: { gte: cutoffDate },
            status: { not: "CANCELLED" },
          },
        },
      },
    },
  });

  const zeroSalesProducts = products.filter((product) => {
    // Check if product has any sales in the period
    const hasSales = product.orderItems.length > 0;
    
    // Also check variants
    const variantHasSales = product.variants.some((variant) => {
      // This would need a separate query for variant sales
      return false; // Simplified for now
    });

    return !hasSales && !variantHasSales;
  });

  return zeroSalesProducts.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    status: product.status,
    variants: product.variants.length,
    lastSaleDate: null,
  }));
}

/**
 * Get stock report
 */
async function getStockReport(options: {
  orgId?: number;
  branchId?: number;
  lowStockOnly?: boolean;
}) {
  const where: any = {};

  if (options.branchId) {
    where.branchId = options.branchId;
  } else if (options.orgId) {
    where.branch = {
      orgId: options.orgId,
    };
  }

  if (options.lowStockOnly) {
    // This would need raw SQL or a more complex query
    // For now, we'll filter in JavaScript
  }

  const inventory = await prisma.inventory.findMany({
    where,
    include: {
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
      branch: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Filter low stock if needed
  let filteredInventory = inventory;
  if (options.lowStockOnly) {
    filteredInventory = inventory.filter((item) => item.quantity <= item.minStock);
  }

  // Calculate totals
  const totalItems = filteredInventory.length;
  const totalValue = filteredInventory.reduce((sum, item) => {
    // Would need product price - simplified for now
    return sum;
  }, 0);

  const lowStockCount = filteredInventory.filter((item) => item.quantity <= item.minStock).length;
  const outOfStockCount = filteredInventory.filter((item) => item.quantity === 0).length;

  return {
    summary: {
      totalItems,
      totalValue,
      lowStockCount,
      outOfStockCount,
    },
    items: filteredInventory,
  };
}

/**
 * Get revenue analytics
 */
async function getRevenueAnalytics(options: {
  orgId?: number;
  branchId?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const where: any = {
    status: { not: "CANCELLED" },
    paymentStatus: "COMPLETED",
  };

  if (options.branchId) {
    where.branchId = options.branchId;
  } else if (options.orgId) {
    where.branch = {
      orgId: options.orgId,
    };
  }

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      where.createdAt.gte = options.startDate;
    }
    if (options.endDate) {
      where.createdAt.lte = options.endDate;
    }
  }

  const orders = await prisma.order.findMany({
    where,
    select: {
      totalAmount: true,
      paymentMethod: true,
      createdAt: true,
    },
  });

  // Calculate by payment method
  const byPaymentMethod = {};
  orders.forEach((order) => {
    const method = order.paymentMethod || "UNKNOWN";
    if (!byPaymentMethod[method]) {
      byPaymentMethod[method] = {
        method: method,
        count: 0,
        total: 0,
      };
    }
    byPaymentMethod[method].count += 1;
    byPaymentMethod[method].total += parseFloat(order.totalAmount.toString());
  });

  const totalRevenue = orders.reduce((sum, order) => sum + parseFloat(order.totalAmount.toString()), 0);

  return {
    totalRevenue,
    totalOrders: orders.length,
    byPaymentMethod: Object.values(byPaymentMethod),
    averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0,
  };
}

module.exports = {
  getSalesReport,
  getTopSellingProducts,
  getZeroSalesProducts,
  getStockReport,
  getRevenueAnalytics,
};

export {};
