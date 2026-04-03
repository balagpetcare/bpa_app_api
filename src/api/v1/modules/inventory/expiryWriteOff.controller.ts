import { Request, Response } from "express";
const expiryWriteOffService = require("./expiryWriteOff.service");

/**
 * POST /inventory/expiry-writeoff/scan
 * Scan for expired stock and write off
 */
exports.scanAndWriteOff = async (req: Request, res: Response) => {
  try {
    const { orgId, locationId, dryRun } = req.body;
    const userId = (req as any).user?.id;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await expiryWriteOffService.scanAndWriteOffExpired({
      orgId,
      locationId,
      dryRun: dryRun || false,
      userId,
    });

    res.json({
      success: true,
      writtenOffCount: result.writtenOffCount,
      totalQuantity: result.totalQuantity,
      items: result.items,
    });
  } catch (error: any) {
    console.error("Error in scanAndWriteOff:", error);
    res.status(500).json({ error: error.message || "Failed to scan and write off expired stock" });
  }
};

/**
 * POST /inventory/expiry-writeoff/manual
 * Manual write-off of expired stock
 */
exports.manualWriteOff = async (req: Request, res: Response) => {
  try {
    const { lotId, locationId, quantity, reason } = req.body;
    const userId = (req as any).user?.id;

    if (!lotId || !locationId || !quantity || !userId) {
      return res.status(400).json({
        error: "lotId, locationId, quantity, and authentication required",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be positive" });
    }

    const result = await expiryWriteOffService.manualWriteOff({
      lotId,
      locationId,
      quantity,
      reason,
      userId,
    });

    res.json({
      success: true,
      ledgerId: result.ledgerId,
      writeOffLogId: result.writeOffLogId,
      remainingQty: result.remainingQty,
    });
  } catch (error: any) {
    console.error("Error in manualWriteOff:", error);
    res.status(400).json({ error: error.message || "Failed to write off stock" });
  }
};

/**
 * GET /inventory/expiry-writeoff/log
 * Get write-off history log
 */
exports.getWriteOffLog = async (req: Request, res: Response) => {
  try {
    const {
      orgId,
      locationId,
      lotId,
      method,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await expiryWriteOffService.getWriteOffLog({
      orgId: Number(orgId),
      locationId: locationId ? Number(locationId) : undefined,
      lotId: lotId ? Number(lotId) : undefined,
      method: method as "AUTO" | "MANUAL" | undefined,
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in getWriteOffLog:", error);
    res.status(500).json({ error: error.message || "Failed to fetch write-off log" });
  }
};

/**
 * GET /inventory/expired-stock
 * Get currently expired stock not yet written off
 */
exports.getExpiredStock = async (req: Request, res: Response) => {
  try {
    const { orgId, locationId, branchId } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await expiryWriteOffService.getExpiredStockSummary({
      orgId: Number(orgId),
      locationId: locationId ? Number(locationId) : undefined,
      branchId: branchId ? Number(branchId) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in getExpiredStock:", error);
    res.status(500).json({ error: error.message || "Failed to fetch expired stock" });
  }
};
