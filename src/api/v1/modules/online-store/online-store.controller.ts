const service = require("./online-store.service");

/**
 * GET /api/v1/online-store/products
 * Get products with aggregated ONLINE_HUB stock
 */
exports.getProducts = async (req, res) => {
  try {
    const result = await service.getOnlineProducts({
      categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : undefined,
      brandId: req.query.brandId ? parseInt(req.query.brandId) : undefined,
      search: req.query.search as string | undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getOnlineProducts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get online products",
    });
  }
};

/**
 * GET /api/v1/online-store/variants/:id/availability
 * Get variant availability per hub
 */
exports.getVariantAvailability = async (req, res) => {
  try {
    const variantId = parseInt(req.params.id);
    if (!variantId) {
      return res.status(400).json({ success: false, message: "Invalid variant ID" });
    }

    const result = await service.getVariantAvailability(variantId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getVariantAvailability error:", error);
    const status = error.message === "Variant not found" || error.message === "Product is not published" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get variant availability",
    });
  }
};

/**
 * POST /api/v1/online-store/checkout/choose-hub
 * Choose nearest hub with stock
 */
exports.chooseHub = async (req, res) => {
  try {
    const { items, latitude, longitude } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required",
      });
    }

    const result = await service.chooseHubForCheckout({
      items: items.map((item: any) => ({
        variantId: parseInt(item.variantId),
        quantity: parseInt(item.quantity),
      })),
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("chooseHub error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to choose hub",
    });
  }
};

export {};
