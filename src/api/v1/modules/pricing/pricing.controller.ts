const service = require("./pricing.service");

/**
 * POST /api/v1/pricing
 * Set location price
 */
exports.setPrice = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { locationId, variantId, price, effectiveFrom, effectiveTo } = req.body;

    if (!locationId || !variantId || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "locationId, variantId, and price are required",
      });
    }

    if (price < 0) {
      return res.status(400).json({
        success: false,
        message: "price must be non-negative",
      });
    }

    const locationPrice = await service.setLocationPrice({
      locationId: parseInt(locationId),
      variantId: parseInt(variantId),
      price: parseFloat(price),
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: locationPrice,
      message: "Price set successfully",
    });
  } catch (error) {
    console.error("setPrice error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to set price",
    });
  }
};

/**
 * GET /api/v1/pricing
 * Get location price
 */
exports.getPrice = async (req, res) => {
  try {
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : undefined;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : undefined;

    if (!locationId || !variantId) {
      return res.status(400).json({
        success: false,
        message: "locationId and variantId are required",
      });
    }

    const price = await service.getLocationPrice(locationId, variantId);

    return res.status(200).json({
      success: true,
      data: price,
    });
  } catch (error) {
    console.error("getPrice error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get price",
    });
  }
};

/**
 * POST /api/v1/inventory/locations/:locationId/variants/:variantId/enable
 * Enable variant at location with channel config
 */
exports.enableLocationVariant = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const locationId = parseInt(req.params.locationId);
    const variantId = parseInt(req.params.variantId);
    const { channel, isEnabled } = req.body;

    if (!channel || !["POS_ONLY", "ONLINE_ONLY", "BOTH"].includes(channel)) {
      return res.status(400).json({
        success: false,
        message: "channel must be POS_ONLY, ONLINE_ONLY, or BOTH",
      });
    }

    const config = await service.enableLocationVariant({
      locationId,
      variantId,
      channel,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
    });

    return res.status(200).json({
      success: true,
      data: config,
      message: "Location variant config updated successfully",
    });
  } catch (error) {
    console.error("enableLocationVariant error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to enable location variant",
    });
  }
};

export {};
