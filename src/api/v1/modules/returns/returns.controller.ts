const service = require("./returns.service");

/**
 * POST /api/v1/returns
 * Create return request
 */
exports.createReturn = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { orderId, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required",
      });
    }

    const returnRequest = await service.createReturnRequest({
      orderId: orderId ? parseInt(orderId) : undefined,
      items: items.map((item: any) => ({
        variantId: parseInt(item.variantId),
        quantity: parseInt(item.quantity),
      })),
      requestedByUserId: userId,
    });

    return res.status(201).json({
      success: true,
      data: returnRequest,
      message: "Return request created successfully",
    });
  } catch (error) {
    console.error("createReturn error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create return request",
    });
  }
};

/**
 * POST /api/v1/returns/:id/approve
 * Approve return request
 */
exports.approveReturn = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const returnRequestId = parseInt(req.params.id);
    if (!returnRequestId) {
      return res.status(400).json({ success: false, message: "Invalid return request ID" });
    }

    const returnRequest = await service.approveReturnRequest(returnRequestId, userId);

    return res.status(200).json({
      success: true,
      data: returnRequest,
      message: "Return request approved successfully",
    });
  } catch (error) {
    console.error("approveReturn error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve return request",
    });
  }
};

/**
 * POST /api/v1/returns/:id/receive
 * Receive return (RETURN_IN / DAMAGE / EXPIRED)
 */
exports.receiveReturn = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const returnRequestId = parseInt(req.params.id);
    if (!returnRequestId) {
      return res.status(400).json({ success: false, message: "Invalid return request ID" });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required",
      });
    }

    const result = await service.receiveReturn(returnRequestId, {
      items: items.map((item: any) => ({
        variantId: parseInt(item.variantId),
        condition: item.condition, // RESELLABLE, DAMAGED, EXPIRED
        locationId: item.locationId ? parseInt(item.locationId) : undefined,
      })),
      receivedByUserId: userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: "Return received successfully",
    });
  } catch (error) {
    console.error("receiveReturn error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to receive return",
    });
  }
};

/**
 * GET /api/v1/returns
 * List returns
 */
exports.getReturns = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await service.getReturns({
      orderId: req.query.orderId ? parseInt(req.query.orderId) : undefined,
      status: req.query.status as string | undefined,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getReturns error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get returns",
    });
  }
};

/**
 * GET /api/v1/returns/:id
 * Get single return
 */
exports.getReturn = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const returnRequestId = parseInt(req.params.id);
    if (!returnRequestId) {
      return res.status(400).json({ success: false, message: "Invalid return request ID" });
    }

    const returnRequest = await service.getReturnById(returnRequestId);

    return res.status(200).json({
      success: true,
      data: returnRequest,
    });
  } catch (error) {
    console.error("getReturn error:", error);
    const status = error.message === "Return request not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get return request",
    });
  }
};

export {};
