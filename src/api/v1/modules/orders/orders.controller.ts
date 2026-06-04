const service = require("./orders.service");
const inventoryService = require("../inventory/inventory.service");
const ledgerService = require("../inventory/ledger.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const branchAccess = require("./ordersBranchAccess.service");
const { restoreInventoryAfterOrderCancel } = require("./ordersCancelInventory.service");

/**
 * GET /api/v1/orders
 * List orders
 */
exports.getOrders = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const resolved = await branchAccess.resolveBranchIdForOrderList(userId, req.query.branchId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ success: false, message: resolved.message });
    }
    const branchId = resolved.branchId;

    const result = await service.getOrders({
      branchId: branchId,
      customerId: req.query.customerId ? parseInt(req.query.customerId) : undefined,
      status: req.query.status,
      fulfilmentInventoryLocationId: req.query.fulfilmentInventoryLocationId
        ? parseInt(req.query.fulfilmentInventoryLocationId) : undefined,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getOrders error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get orders",
    });
  }
};

/**
 * GET /api/v1/orders/:id
 * Get single order
 */
exports.getOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orderId = parseInt(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    let branchId: number | undefined;
    try {
      const a = await branchAccess.assertOrderBranchAccess(userId, orderId);
      branchId = a.branchId;
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ success: false, message: e?.message || "Access denied" });
    }

    const order = await service.getOrderById(orderId, branchId);

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("getOrder error:", error);
    const status = error.message === "Order not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get order",
    });
  }
};

/**
 * POST /api/v1/orders
 * Create new order. ONLINE requires fulfilmentInventoryLocationId (ONLINE_HUB). POS/CLINIC resolve default location.
 */
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, customerId, items, paymentMethod, notes, orderSource, fulfilmentInventoryLocationId } = req.body;

    if (!branchId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "branchId and items are required",
      });
    }

    const branchIdNum = parseInt(branchId);

    // Verify user has access to branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, branchId: branchIdNum, status: "ACTIVE" },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
      });
    }

    let resolvedLocationId = fulfilmentInventoryLocationId != null ? parseInt(fulfilmentInventoryLocationId) : null;
    const source = (orderSource && ["ONLINE", "POS", "CLINIC", "OTHER"].includes(orderSource)) ? orderSource : null;

    if (source === "ONLINE") {
      if (resolvedLocationId == null) {
        return res.status(400).json({
          success: false,
          message: "orderSource ONLINE requires fulfilmentInventoryLocationId (choose-hub hubId)",
        });
      }
      const loc = await prisma.inventoryLocation.findFirst({
        where: { id: resolvedLocationId, type: "ONLINE_HUB", isActive: true },
        select: { id: true },
      });
      if (!loc) {
        return res.status(400).json({
          success: false,
          message: "fulfilmentInventoryLocationId must be an active ONLINE_HUB location",
        });
      }
    } else if (source === "POS") {
      const shopLocId = await service.getDefaultFulfilmentLocationForBranch(branchIdNum, "SHOP");
      if (shopLocId != null) resolvedLocationId = shopLocId;
    } else if (source === "CLINIC") {
      const clinicLocId = await service.getDefaultFulfilmentLocationForBranch(branchIdNum, "CLINIC");
      if (clinicLocId != null) resolvedLocationId = clinicLocId;
    }

    if (resolvedLocationId != null) {
      for (const item of items) {
        if (!item.productId || !item.quantity || !item.price) {
          return res.status(400).json({
            success: false,
            message: "Each item must have productId, quantity, and price",
          });
        }
        if (item.variantId) {
          const balance = await ledgerService.getStockBalance(resolvedLocationId, parseInt(item.variantId));
          const available = balance.onHandQty - balance.reservedQty;
          if (available < item.quantity) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for variant ${item.variantId} at fulfilment location`,
            });
          }
        }
      }
    } else {
      for (const item of items) {
        if (!item.productId || !item.quantity || !item.price) {
          return res.status(400).json({
            success: false,
            message: "Each item must have productId, quantity, and price",
          });
        }
        if (item.variantId) {
          const inventory = await inventoryService.getInventory({
            branchId: branchIdNum,
            productId: item.productId,
            variantId: item.variantId,
            limit: 1,
          });
          if (inventory.items.length === 0 || inventory.items[0].quantity < item.quantity) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for product variant ${item.variantId}`,
            });
          }
        }
      }
    }

    const order = await service.createOrder({
      branchId: branchIdNum,
      customerId: customerId ? parseInt(customerId) : undefined,
      items: items.map((item) => ({
        productId: parseInt(item.productId),
        variantId: item.variantId ? parseInt(item.variantId) : undefined,
        quantity: parseInt(item.quantity),
        price: parseFloat(item.price),
      })),
      paymentMethod: paymentMethod,
      notes: notes,
      createdByUserId: userId,
      fulfilmentInventoryLocationId: resolvedLocationId,
      orderSource: source,
    });

    if (resolvedLocationId != null && source) {
      const saleType = source === "ONLINE" ? "SALE_ONLINE" : source === "CLINIC" ? "SALE_CLINIC" : "SALE_POS";
      for (const item of items) {
        if (item.variantId) {
          await ledgerService.saleFEFO({
            locationId: resolvedLocationId,
            variantId: parseInt(item.variantId),
            quantity: parseInt(item.quantity),
            saleType,
            refType: "ORDER",
            refId: String(order.id),
            createdByUserId: userId,
          });
        }
      }
    } else {
      for (const item of items) {
        if (item.variantId) {
          const inventory = await inventoryService.getInventory({
            branchId: branchIdNum,
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
                reason: `Order ${order.orderNumber}`,
                createdByUserId: userId,
              },
              branchIdNum
            );
          }
        }
      }
    }

    return res.status(201).json({
      success: true,
      data: order,
      message: "Order created successfully",
    });
  } catch (error) {
    console.error("createOrder error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create order",
    });
  }
};

/**
 * PATCH /api/v1/orders/:id/status
 * Update order status
 */
exports.updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orderId = parseInt(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "status is required",
      });
    }

    let branchId: number | undefined;
    try {
      const a = await branchAccess.assertOrderBranchAccess(userId, orderId);
      branchId = a.branchId;
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ success: false, message: e?.message || "Access denied" });
    }

    const order = await service.updateOrderStatus(orderId, status, branchId);

    return res.status(200).json({
      success: true,
      data: order,
      message: "Order status updated successfully",
    });
  } catch (error) {
    console.error("updateOrderStatus error:", error);
    const status = error.message === "Order not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to update order status",
    });
  }
};

/**
 * POST /api/v1/orders/:id/payment
 * Process payment
 */
exports.processPayment = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orderId = parseInt(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const { paymentMethod, paymentStatus } = req.body;

    if (!paymentMethod || !paymentStatus) {
      return res.status(400).json({
        success: false,
        message: "paymentMethod and paymentStatus are required",
      });
    }

    let branchId: number | undefined;
    try {
      const a = await branchAccess.assertOrderBranchAccess(userId, orderId);
      branchId = a.branchId;
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ success: false, message: e?.message || "Access denied" });
    }

    const order = await service.processPayment(
      orderId,
      {
        paymentMethod: paymentMethod,
        paymentStatus: paymentStatus,
      },
      branchId
    );

    return res.status(200).json({
      success: true,
      data: order,
      message: "Payment processed successfully",
    });
  } catch (error) {
    console.error("processPayment error:", error);
    const status = error.message === "Order not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to process payment",
    });
  }
};

/**
 * POST /api/v1/orders/:id/cancel
 * Cancel order
 */
exports.cancelOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orderId = parseInt(req.params.id);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const { reason } = req.body;

    let branchId: number | undefined;
    try {
      const a = await branchAccess.assertOrderBranchAccess(userId, orderId);
      branchId = a.branchId;
    } catch (e: any) {
      const status = e?.status || 500;
      return res.status(status).json({ success: false, message: e?.message || "Access denied" });
    }

    const result = await service.cancelOrder(orderId, reason, branchId);
    const order = result.order;
    const performedCancel = result.performedCancel === true;

    await restoreInventoryAfterOrderCancel(userId, order, performedCancel, branchId);

    return res.status(200).json({
      success: true,
      data: order,
      message: performedCancel ? "Order cancelled successfully" : "Order already cancelled",
    });
  } catch (error) {
    console.error("cancelOrder error:", error);
    const status = error.message === "Order not found" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to cancel order",
    });
  }
};

export {};
