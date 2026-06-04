/**
 * Shared stock restore after order cancel (ledger FEFO path vs legacy inventory rows).
 * Used by `orders.controller` and POS-scoped cancel to avoid diverging business logic.
 */
const inventoryService = require("../inventory/inventory.service");
const ledgerService = require("../inventory/ledger.service");

async function restoreInventoryAfterOrderCancel(
  userId: number,
  order: {
    id: number;
    orderNumber?: string | null;
    status: string;
    fulfilmentInventoryLocationId?: number | null;
    items?: Array<{ variantId?: number | null; productId?: number | null; quantity: number }>;
  },
  performedCancel: boolean,
  branchId?: number
): Promise<void> {
  if (!performedCancel || order.status !== "CANCELLED") return;

  if (order.fulfilmentInventoryLocationId != null && order.items?.length) {
    const restoreItems = order.items
      .filter((i) => i.variantId)
      .map((i) => ({ variantId: i.variantId as number, quantity: i.quantity }));
    if (restoreItems.length > 0) {
      await ledgerService.restoreStockForOrderCancel({
        locationId: order.fulfilmentInventoryLocationId,
        items: restoreItems,
        refId: String(order.id),
        createdByUserId: userId,
      });
    }
    return;
  }

  if (!branchId) return;

  for (const item of order.items || []) {
    if (item.variantId && item.productId) {
      const inventory = await inventoryService.getInventory({
        branchId,
        productId: item.productId,
        variantId: item.variantId,
        limit: 1,
      });
      if (inventory.items.length > 0) {
        await inventoryService.adjustStock(
          inventory.items[0].id,
          {
            type: "IN",
            quantity: item.quantity,
            reason: `Order ${order.orderNumber || order.id} cancelled - stock restored`,
            createdByUserId: userId,
          },
          branchId
        );
      }
    }
  }
}

module.exports = { restoreInventoryAfterOrderCancel };

export {};
