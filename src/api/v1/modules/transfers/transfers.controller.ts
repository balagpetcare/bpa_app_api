const service = require("./transfers.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const { INVENTORY_ERROR_CODES } = require("../../constants/inventoryErrors");

/**
 * POST /api/v1/transfers
 * Create transfer (draft). Lot-backed only: allocations[] with lotId, variantId, quantity.
 */
exports.createTransfer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { fromLocationId, toLocationId, allocations } = req.body;
    const items = allocations || req.body.items;

    if (!fromLocationId || !toLocationId) {
      return res.status(400).json({
        success: false,
        message: "fromLocationId and toLocationId are required",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "allocations array is required (each: lotId, variantId, quantity)",
      });
    }

    const parsed = items.map((a: any) => {
      const lotId = a.lotId != null ? parseInt(a.lotId) : null;
      const variantId = parseInt(a.variantId);
      const quantity = parseInt(a.quantity);
      if (!lotId) {
        throw new Error("lotId is required for each allocation (lot-backed transfers only)");
      }
      if (!variantId || !quantity || quantity <= 0) {
        throw new Error("variantId and positive quantity are required for each allocation");
      }
      return { lotId, variantId, quantity };
    });

    const transfer = await service.createTransfer({
      fromLocationId: parseInt(fromLocationId),
      toLocationId: parseInt(toLocationId),
      items: parsed,
      createdByUserId: userId,
    });

    return res.status(201).json({
      success: true,
      data: transfer,
      message: "Transfer created successfully",
    });
  } catch (error) {
    console.error("createTransfer error:", error);
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to create transfer",
    });
  }
};

/**
 * POST /api/v1/transfers/:id/send
 * Send transfer (TRANSFER_OUT)
 */
exports.sendTransfer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const transferId = parseInt(req.params.id);
    if (!transferId) {
      return res.status(400).json({ success: false, message: "Invalid transfer ID" });
    }

    const result = await service.sendTransfer(transferId, userId);

    return res.status(200).json({
      success: true,
      data: result,
      message: "Transfer sent successfully",
    });
  } catch (error) {
    console.error("sendTransfer error:", error);
    const code = (error as any).code;
    if (code === "LOT_EXPIRED" || code === INVENTORY_ERROR_CODES.LOT_EXPIRED) {
      return res.status(400).json({
        success: false,
        message: (error as Error).message,
        code: INVENTORY_ERROR_CODES.LOT_EXPIRED,
      });
    }
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to send transfer",
    });
  }
};

/**
 * POST /api/v1/transfers/:id/receive
 * Receive transfer (TRANSFER_IN + optional DAMAGE/EXPIRED)
 */
exports.receiveTransfer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const transferId = parseInt(req.params.id);
    if (!transferId) {
      return res.status(400).json({ success: false, message: "Invalid transfer ID" });
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: "items array is required (may be empty for full receive)",
      });
    }

    const result = await service.receiveTransfer(transferId, {
      items: items.map((item: any) => ({
        variantId: parseInt(item.variantId),
        quantityReceived: parseInt(item.quantityReceived || 0),
        quantityDamaged: parseInt(item.quantityDamaged || 0),
        quantityExpired: parseInt(item.quantityExpired || 0),
        lotId: item.lotId != null ? parseInt(item.lotId) : undefined,
      })),
      notes: (req.body as any).notes,
      evidenceMediaIds: (req.body as any).evidenceMediaIds,
      createdByUserId: userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: "Transfer received successfully",
    });
  } catch (error) {
    console.error("receiveTransfer error:", error);
    const code = (error as any).code;
    if (code === "LOT_EXPIRED" || code === INVENTORY_ERROR_CODES.LOT_EXPIRED) {
      return res.status(400).json({
        success: false,
        message: (error as Error).message,
        code: INVENTORY_ERROR_CODES.LOT_EXPIRED,
      });
    }
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to receive transfer",
    });
  }
};

/**
 * POST /api/v1/transfers/:id/resolve-dispute
 * Owner: Resolve disputed transfer (ACCEPT_LOSS, RESEND, DAMAGE_WRITEOFF)
 */
exports.resolveDispute = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const transferId = parseInt(req.params.id);
    if (!transferId) {
      return res.status(400).json({ success: false, message: "Invalid transfer ID" });
    }

    const { resolutionType, note } = req.body;
    if (!resolutionType || !["ACCEPT_LOSS", "RESEND", "DAMAGE_WRITEOFF"].includes(resolutionType)) {
      return res.status(400).json({
        success: false,
        message: "resolutionType must be ACCEPT_LOSS, RESEND, or DAMAGE_WRITEOFF",
      });
    }

    const result = await service.resolveDispute(transferId, {
      resolutionType,
      note,
      resolvedByUserId: userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: "Dispute resolved successfully",
    });
  } catch (error) {
    console.error("resolveDispute error:", error);
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Failed to resolve dispute",
    });
  }
};

/**
 * GET /api/v1/transfers
 * List transfers
 */
exports.getTransfers = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await service.getTransfers({
      fromLocationId: req.query.fromLocationId ? parseInt(req.query.fromLocationId) : undefined,
      toLocationId: req.query.toLocationId ? parseInt(req.query.toLocationId) : undefined,
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
    console.error("getTransfers error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get transfers",
    });
  }
};

/**
 * GET /api/v1/transfers/:id
 * Get single transfer
 */
exports.getTransfer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const transferId = parseInt(req.params.id);
    if (!transferId) {
      return res.status(400).json({ success: false, message: "Invalid transfer ID" });
    }

    const transfer = await service.getTransferById(transferId);

    return res.status(200).json({
      success: true,
      data: transfer,
    });
  } catch (error) {
    console.error("getTransfer error:", error);
    const status = error.message === "Transfer not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      message: error.message || "Failed to get transfer",
    });
  }
};

export {};
