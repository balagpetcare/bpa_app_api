const orderService = require("../orders/orders.service");
const ledgerService = require("../inventory/ledger.service");
const inventoryService = require("../inventory/inventory.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Create POS sale (order with immediate payment). Stock deducted from branch SHOP InventoryLocation via ledger.
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
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(data.branchId, "SHOP");

  if (shopLocationId != null) {
    for (const item of data.items) {
      if (item.variantId) {
        const balance = await ledgerService.getStockBalance(shopLocationId, item.variantId);
        const available = balance.onHandQty - balance.reservedQty;
        if (available < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.variantId} at shop location`);
        }
      }
    }
  }

  const order = await orderService.createOrder({
    branchId: data.branchId,
    customerId: data.customerId,
    items: data.items,
    paymentMethod: data.paymentMethod,
    notes: data.notes || "POS Sale",
    createdByUserId: data.createdByUserId,
    orderSource: "POS",
    fulfilmentInventoryLocationId: shopLocationId ?? undefined,
  });

  const paidOrder = await orderService.processPayment(order.id, {
    paymentMethod: data.paymentMethod,
    paymentStatus: "COMPLETED",
  });

  const confirmedOrder = await orderService.updateOrderStatus(
    paidOrder.id,
    "CONFIRMED",
    data.branchId
  );

  if (shopLocationId != null) {
    for (const item of data.items) {
      if (item.variantId) {
        await ledgerService.saleFEFO({
          locationId: shopLocationId,
          variantId: item.variantId,
          quantity: item.quantity,
          saleType: "SALE_POS",
          refType: "ORDER",
          refId: String(confirmedOrder.id),
          createdByUserId: data.createdByUserId,
        });
      }
    }
  } else {
    for (const item of data.items) {
      if (item.variantId) {
        const inv = await inventoryService.getInventory({
          branchId: data.branchId,
          productId: item.productId,
          variantId: item.variantId,
          limit: 1,
        });
        if (inv.items.length > 0) {
          await inventoryService.adjustStock(
            inv.items[0].id,
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
