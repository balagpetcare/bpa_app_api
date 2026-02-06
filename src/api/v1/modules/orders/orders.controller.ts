const service = require("./orders.service");
const inventoryService = require("../inventory/inventory.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

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

    // Get user's branch membership
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId || parseInt(req.query.branchId) || undefined;

    const result = await service.getOrders({
      branchId: branchId,
      customerId: req.query.customerId ? parseInt(req.query.customerId) : undefined,
      status: req.query.status,
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

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

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
 * Create new order
 */
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, customerId, items, paymentMethod, notes } = req.body;

    if (!branchId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "branchId and items are required",
      });
    }

    // Verify user has access to branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, branchId: branchId, status: "ACTIVE" },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
      });
    }

    // Verify items and check stock
    for (const item of items) {
      if (!item.productId || !item.quantity || !item.price) {
        return res.status(400).json({
          success: false,
          message: "Each item must have productId, quantity, and price",
        });
      }

      // Check inventory (if variant specified)
      if (item.variantId) {
        const inventory = await inventoryService.getInventory({
          branchId: branchId,
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

    const order = await service.createOrder({
      branchId: parseInt(branchId),
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
    });

    // Deduct stock for each item
    for (const item of items) {
      if (item.variantId) {
        // Find inventory item
        const inventory = await inventoryService.getInventory({
          branchId: branchId,
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
            branchId
          );
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

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

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

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

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

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const order = await service.cancelOrder(orderId, reason, branchId);

    // Restore stock if order was confirmed/processing
    if (order.status === "CANCELLED") {
      for (const item of order.items) {
        if (item.variantId) {
          // Find inventory and restore stock
          const inventory = await inventoryService.getInventory({
            branchId: branchId,
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
                reason: `Order ${order.orderNumber} cancelled - stock restored`,
                createdByUserId: userId,
              },
              branchId
            );
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: order,
      message: "Order cancelled successfully",
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
