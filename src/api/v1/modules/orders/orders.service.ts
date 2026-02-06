const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Generate unique order number
 */
function generateOrderNumber() {
  const prefix = "BPA";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Get orders with pagination and filters
 */
async function getOrders(options: {
  branchId?: number;
  customerId?: number;
  status?: string;
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

  if (options.customerId) {
    where.customerId = options.customerId;
  }

  if (options.status) {
    where.status = options.status;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
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
        customer: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
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
        items: {
          include: {
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
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items: orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single order by ID
 */
async function getOrderById(orderId: number, branchId?: number) {
  const where: any = { id: orderId };
  if (branchId) {
    where.branchId = branchId;
  }

  const order = await prisma.order.findFirst({
    where,
    include: {
      branch: true,
      customer: {
        include: {
          profile: true,
        },
      },
      createdBy: {
        include: {
          profile: true,
        },
      },
      items: {
        include: {
          product: {
            include: {
              variants: true,
            },
          },
          variant: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  return order;
}

/**
 * Create new order
 */
async function createOrder(data: {
  branchId: number;
  customerId?: number;
  items: Array<{
    productId: number;
    variantId?: number;
    quantity: number;
    price: number;
  }>;
  paymentMethod?: string;
  notes?: string;
  createdByUserId?: number;
}) {
  // Calculate total
  const totalAmount = data.items.reduce((sum, item) => {
    return sum + item.price * item.quantity;
  }, 0);

  // Generate order number
  const orderNumber = generateOrderNumber();

  // Create order with items
  const order = await prisma.order.create({
    data: {
      orderNumber: orderNumber,
      branchId: data.branchId,
      customerId: data.customerId || null,
      status: "PENDING",
      totalAmount: totalAmount,
      paymentMethod: data.paymentMethod || null,
      paymentStatus: "PENDING",
      notes: data.notes || null,
      createdByUserId: data.createdByUserId || null,
      items: {
        create: data.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || null,
          quantity: item.quantity,
          price: item.price,
          total: item.price * item.quantity,
        })),
      },
    },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  return order;
}

/**
 * Update order status
 */
async function updateOrderStatus(
  orderId: number,
  status: string,
  branchId?: number
) {
  const where: any = { id: orderId };
  if (branchId) {
    where.branchId = branchId;
  }

  const existing = await prisma.order.findFirst({ where });
  if (!existing) {
    throw new Error("Order not found");
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status: status },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  return order;
}

/**
 * Process payment for order
 */
async function processPayment(
  orderId: number,
  data: {
    paymentMethod: string;
    paymentStatus: string;
  },
  branchId?: number
) {
  const where: any = { id: orderId };
  if (branchId) {
    where.branchId = branchId;
  }

  const existing = await prisma.order.findFirst({ where });
  if (!existing) {
    throw new Error("Order not found");
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentMethod: data.paymentMethod,
      paymentStatus: data.paymentStatus,
      // If payment completed, update order status
      ...(data.paymentStatus === "COMPLETED" && { status: "CONFIRMED" }),
    },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  return order;
}

/**
 * Cancel order
 */
async function cancelOrder(orderId: number, reason?: string, branchId?: number) {
  const where: any = { id: orderId };
  if (branchId) {
    where.branchId = branchId;
  }

  const existing = await prisma.order.findFirst({ where });
  if (!existing) {
    throw new Error("Order not found");
  }

  if (existing.status === "DELIVERED" || existing.status === "CANCELLED") {
    throw new Error(`Cannot cancel order with status: ${existing.status}`);
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "CANCELLED",
      paymentStatus: existing.paymentStatus === "COMPLETED" ? "REFUNDED" : "FAILED",
      notes: reason
        ? `${existing.notes || ""}\nCancelled: ${reason}`.trim()
        : existing.notes,
    },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  return order;
}

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  processPayment,
  cancelOrder,
};

export {};
