const orderService = require("../orders/orders.service");
const inventoryService = require("../inventory/inventory.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Create POS sale (simplified order creation with immediate payment)
 */
async function createSale(data: {
  branchId: number;
  items: Array<{
    productId: number;
    variantId?: number;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  customerId?: number;
  notes?: string;
  createdByUserId?: number;
}) {
  // Create order with CONFIRMED status (POS sales are immediate)
  const order = await orderService.createOrder({
    branchId: data.branchId,
    customerId: data.customerId,
    items: data.items,
    paymentMethod: data.paymentMethod,
    notes: data.notes || "POS Sale",
    createdByUserId: data.createdByUserId,
  });

  // Immediately process payment
  const paidOrder = await orderService.processPayment(order.id, {
    paymentMethod: data.paymentMethod,
    paymentStatus: "COMPLETED",
  });

  // Update order status to CONFIRMED
  const confirmedOrder = await orderService.updateOrderStatus(
    paidOrder.id,
    "CONFIRMED",
    data.branchId
  );

  // Deduct stock immediately
  for (const item of data.items) {
    if (item.variantId) {
      const inventory = await inventoryService.getInventory({
        branchId: data.branchId,
        productId: item.productId,
        variantId: item.variantId,
        limit: 1,
      });

      if (inventory.items.length > 0) {
        await inventoryService.adjustStock(
          inventory.items[0].id,
          {
            type: "OUT",
            quantity: item.quantity,
            reason: `POS Sale - Order ${confirmedOrder.orderNumber}`,
            createdByUserId: data.createdByUserId,
          },
          data.branchId
        );
      }
    }
  }

  return confirmedOrder;
}

/**
 * Get receipt data for order
 */
async function getReceipt(orderId: number, branchId?: number) {
  const order = await orderService.getOrderById(orderId, branchId);

  // Format receipt data
  return {
    orderNumber: order.orderNumber,
    date: order.createdAt,
    branch: {
      name: order.branch?.name || "Branch",
      address: order.branch?.addressJson || {},
    },
    customer: order.customer
      ? {
          name: order.customer.profile?.displayName || "Customer",
        }
      : null,
    items: order.items.map((item) => ({
      product: item.product.name,
      variant: item.variant?.title || "Standard",
      quantity: item.quantity,
      price: item.price,
      total: item.total,
    })),
    subtotal: order.totalAmount,
    total: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
}

module.exports = {
  createSale,
  getReceipt,
};

export {};
