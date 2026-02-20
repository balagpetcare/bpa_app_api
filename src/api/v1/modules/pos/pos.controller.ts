const service = require("./pos.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * POST /api/v1/pos/sale
 * Create POS sale (immediate order with payment)
 */
exports.createSale = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { branchId, items, paymentMethod, customerId, notes } = req.body;

    if (!branchId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "branchId, items, and paymentMethod are required",
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "paymentMethod is required (CASH, CARD, MOBILE, ONLINE)",
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

      // Check inventory
      const inventory = await prisma.inventory.findFirst({
        where: {
          branchId: branchId,
          productId: item.productId,
          variantId: item.variantId || null,
        },
      });

      if (!inventory || inventory.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product ${item.productId}`,
        });
      }
    }

    const order = await service.createSale({
      branchId: parseInt(branchId),
      customerId: customerId ? parseInt(customerId) : undefined,
      items: items.map((item) => ({
        productId: parseInt(item.productId),
        variantId: item.variantId ? parseInt(item.variantId) : undefined,
        quantity: parseInt(item.quantity),
        price: parseFloat(item.price),
      })),
      paymentMethod: paymentMethod,
      notes: notes || "POS Sale",
      createdByUserId: userId,
    });

    return res.status(201).json({
      success: true,
      data: order,
      message: "Sale completed successfully",
    });
  } catch (error) {
    console.error("createSale error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create sale",
    });
  }
};

/**
 * GET /api/v1/pos/receipt/:orderId
 * Get receipt for order
 */
exports.getReceipt = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const orderId = parseInt(req.params.orderId);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Get user's branch
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, status: "ACTIVE" },
      select: { branchId: true },
    });

    const branchId = branchMember?.branchId;

    const receipt = await service.getReceipt(orderId, branchId);

    return res.status(200).json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("getReceipt error:", error);
    const status = error.message === "Order not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get receipt",
    });
  }
};

/**
 * GET /api/v1/pos/products
 * Get products for POS (quick search)
 */
exports.getProducts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const branchId = parseInt(req.query.branchId);
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "branchId is required",
      });
    }

    // Verify user has access
    const branchMember = await prisma.branchMember.findFirst({
      where: { userId: userId, branchId: branchId, status: "ACTIVE" },
    });

    if (!branchMember) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this branch",
      });
    }

    // Get products with inventory
    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        org: {
          branches: {
            some: { id: branchId },
          },
        },
      },
      include: {
        variants: {
          where: { isActive: true },
        },
      },
      take: 100, // Limit for POS quick search
    });

    // Get inventory for each product/variant
    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const variantsWithStock = await Promise.all(
          (product.variants || []).map(async (variant) => {
            const inventory = await prisma.inventory.findFirst({
              where: {
                branchId: branchId,
                productId: product.id,
                variantId: variant.id,
              },
            });

            return {
              ...variant,
              stock: inventory?.quantity || 0,
              minStock: inventory?.minStock || 10,
            };
          })
        );

        // Also check base product inventory (no variant)
        const baseInventory = await prisma.inventory.findFirst({
          where: {
            branchId: branchId,
            productId: product.id,
            variantId: null,
          },
        });

        return {
          ...product,
          variants: variantsWithStock,
          baseStock: baseInventory?.quantity || 0,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: productsWithStock,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get products",
    });
  }
};

export {};
