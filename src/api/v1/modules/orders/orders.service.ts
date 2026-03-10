const prisma = require("../../../../infrastructure/db/prismaClient");
let domainEvents: { emit: (name: string, payload: Record<string, unknown>) => void; DOMAIN_EVENTS: Record<string, string> } | null = null;
function getDomainEvents() {
  if (!domainEvents) {
    try {
      domainEvents = require("../services/domainEvents.service");
    } catch {
      domainEvents = { emit: () => {}, DOMAIN_EVENTS: {} };
    }
  }
  return domainEvents;
}

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
  fulfilmentInventoryLocationId?: number;
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

  if (options.fulfilmentInventoryLocationId != null) {
    where.fulfilmentInventoryLocationId = options.fulfilmentInventoryLocationId;
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
        fulfilmentInventoryLocation: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            branch: { select: { id: true, name: true } },
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
      fulfilmentInventoryLocation: {
        select: {
          id: true,
          name: true,
          code: true,
          type: true,
          branch: { select: { id: true, name: true } },
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
 * Get branch's default InventoryLocation by type (SHOP or CLINIC). Fallback: first active of that type.
 */
async function getDefaultFulfilmentLocationForBranch(
  branchId: number,
  type: "SHOP" | "CLINIC"
): Promise<number | null> {
  const loc = await prisma.inventoryLocation.findFirst({
    where: { branchId, type, isActive: true },
    select: { id: true },
  });
  return loc?.id ?? null;
}

/**
 * Create new order
 */
async function createOrder(data: {
  branchId: number;
  customerId?: number;
  items: Array<{
    productId?: number | null;
    variantId?: number | null;
    serviceId?: number | null;
    quantity: number;
    price: number;
  }>;
  paymentMethod?: string;
  notes?: string;
  createdByUserId?: number;
  fulfilmentInventoryLocationId?: number | null;
  orderSource?: string | null;
  visitId?: number | null;
}) {
  // Each item must have either productId or serviceId
  const totalAmount = data.items.reduce((sum, item) => {
    return sum + item.price * item.quantity;
  }, 0);

  const orderNumber = generateOrderNumber();

  const orderData: any = {
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
        productId: item.productId ?? null,
        variantId: item.variantId ?? null,
        serviceId: item.serviceId ?? null,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
      })),
    },
  };
  if (data.fulfilmentInventoryLocationId != null) {
    orderData.fulfilmentInventoryLocationId = data.fulfilmentInventoryLocationId;
  }
  if (data.orderSource != null && ["ONLINE", "POS", "CLINIC", "OTHER"].includes(data.orderSource)) {
    orderData.orderSource = data.orderSource;
  }
  if (data.visitId != null) {
    orderData.visitId = data.visitId;
  }

  // Create order with items
  const order = await prisma.order.create({
    data: orderData,
    include: {
      branch: true,
      customer: true,
      fulfilmentInventoryLocation: {
        select: {
          id: true,
          name: true,
          code: true,
          type: true,
          branch: { select: { id: true, name: true } },
        },
      },
      items: {
        include: {
          product: true,
          variant: true,
          service: true,
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

  if (data.paymentStatus === "COMPLETED" && order.visitId) {
    try {
      const { createSettlementLedgerForOrder } = require("../clinic/doctorSettlement.service");
      createSettlementLedgerForOrder(orderId).catch(() => {});
    } catch (_) {
      // clinic module optional for non-clinic orders
    }
  }

  return order;
}

/**
 * Cancel order. Idempotent: if already CANCELLED, returns order without updating (no double restore).
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

  if (existing.status === "DELIVERED") {
    throw new Error(`Cannot cancel order with status: ${existing.status}`);
  }

  if (existing.status === "CANCELLED") {
    const alreadyCancelled = await prisma.order.findFirst({
      where: { id: orderId },
      include: {
        branch: true,
        customer: true,
        items: { include: { product: true, variant: true } },
      },
    });
    return { order: alreadyCancelled, performedCancel: false };
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

  if (existing.paymentStatus === "COMPLETED") {
    try {
      const { emit, DOMAIN_EVENTS } = getDomainEvents();
      if (DOMAIN_EVENTS.REFUND_PROCESSED) {
        emit(DOMAIN_EVENTS.REFUND_PROCESSED, {
          orderId,
          branchId: order.branchId,
          reason: reason ?? null,
        });
      }
    } catch (_) {}
  }

  return { order, performedCancel: true };
}

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  processPayment,
  cancelOrder,
  getDefaultFulfilmentLocationForBranch,
};

export {};
