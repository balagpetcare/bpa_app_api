import { Request, Response } from "express";
const batchRecallService = require("./batchRecall.service");

/**
 * POST /inventory/recalls
 * Create batch recall
 */
exports.createRecall = async (req: Request, res: Response) => {
  try {
    const { orgId, lotId, reason, severity, campaignId } = req.body;
    const userId = (req as any).user?.id;

    if (!orgId || !lotId || !reason || !userId) {
      return res.status(400).json({
        error: "orgId, lotId, reason, and authentication required",
      });
    }

    if (!["STANDARD", "URGENT", "CRITICAL"].includes(severity)) {
      return res.status(400).json({
        error: "severity must be STANDARD, URGENT, or CRITICAL",
      });
    }

    const result = await batchRecallService.createRecall({
      orgId,
      lotId,
      reason,
      severity,
      initiatedById: userId,
      campaignId: campaignId != null ? parseInt(String(campaignId), 10) : undefined,
    });

    res.status(201).json({
      success: true,
      recall: result.recall,
      affectedLocations: result.affectedLocations,
    });
  } catch (error: any) {
    console.error("Error in createRecall:", error);
    res.status(400).json({ error: error.message || "Failed to create recall" });
  }
};

/**
 * GET /inventory/recalls
 * List recalls with filters
 */
exports.listRecalls = async (req: Request, res: Response) => {
  try {
    const { orgId, status, severity, lotId, page, limit } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await batchRecallService.listRecalls({
      orgId: Number(orgId),
      status: status as any,
      severity: severity as any,
      lotId: lotId ? Number(lotId) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in listRecalls:", error);
    res.status(500).json({ error: error.message || "Failed to list recalls" });
  }
};

/**
 * GET /inventory/recalls/:id
 * Get recall detail with affected locations
 */
exports.getRecallDetail = async (req: Request, res: Response) => {
  try {
    const recallId = Number(req.params.id);
    const orgId = req.query.orgId != null ? Number(req.query.orgId) : NaN;

    if (isNaN(recallId)) {
      return res.status(400).json({ error: "Invalid recall ID" });
    }
    if (!Number.isFinite(orgId) || orgId <= 0) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await batchRecallService.getRecallDetail(recallId, orgId);

    res.json(result);
  } catch (error: any) {
    console.error("Error in getRecallDetail:", error);
    if (error.message === "Recall not found") {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || "Failed to get recall detail" });
  }
};

/**
 * POST /inventory/recalls/:id/quarantine
 * Quarantine recalled lot at a location
 */
exports.quarantineLot = async (req: Request, res: Response) => {
  try {
    const recallId = Number(req.params.id);
    const { locationId, targetLocationId } = req.body;
    const userId = (req as any).user?.id;

    if (isNaN(recallId) || !locationId || !targetLocationId || !userId) {
      return res.status(400).json({
        error: "recallId, locationId, targetLocationId, and authentication required",
      });
    }

    const result = await batchRecallService.quarantineLot({
      recallId,
      locationId,
      targetLocationId,
      userId,
    });

    res.json({
      success: true,
      transferId: result.transferId,
      quantityMoved: result.quantityMoved,
      allLocationsCleared: result.allLocationsCleared,
    });
  } catch (error: any) {
    console.error("Error in quarantineLot:", error);
    res.status(400).json({ error: error.message || "Failed to quarantine lot" });
  }
};

/**
 * POST /inventory/recalls/:id/resolve
 * Resolve recall
 */
exports.resolveRecall = async (req: Request, res: Response) => {
  try {
    const recallId = Number(req.params.id);
    const { notes } = req.body;
    const userId = (req as any).user?.id;

    if (isNaN(recallId) || !userId) {
      return res.status(400).json({
        error: "recallId and authentication required",
      });
    }

    const result = await batchRecallService.resolveRecall({
      recallId,
      userId,
      notes,
    });

    res.json({
      success: true,
      recall: result.recall,
    });
  } catch (error: any) {
    console.error("Error in resolveRecall:", error);
    res.status(400).json({ error: error.message || "Failed to resolve recall" });
  }
};

/**
 * POST /inventory/recalls/:id/cancel
 * Cancel recall
 */
/**
 * POST /inventory/recalls/:id/release-allocation
 * Allow FEFO/dispatch again while recall stays ACTIVE (supervised).
 */
exports.releaseAllocation = async (req: Request, res: Response) => {
  try {
    const recallId = Number(req.params.id);
    const { orgId } = req.body || {};
    const userId = (req as any).user?.id;

    if (isNaN(recallId) || !orgId || !userId) {
      return res.status(400).json({
        error: "recallId, orgId, and authentication required",
      });
    }

    const recall = await batchRecallService.releaseRecallAllocation({
      recallId,
      orgId: Number(orgId),
      userId,
    });

    res.json({
      success: true,
      recall,
    });
  } catch (error: any) {
    console.error("Error in releaseAllocation:", error);
    res.status(400).json({ error: error.message || "Failed to release allocation" });
  }
};

exports.cancelRecall = async (req: Request, res: Response) => {
  try {
    const recallId = Number(req.params.id);
    const { notes } = req.body;
    const userId = (req as any).user?.id;

    if (isNaN(recallId) || !userId) {
      return res.status(400).json({
        error: "recallId and authentication required",
      });
    }

    const result = await batchRecallService.cancelRecall({
      recallId,
      userId,
      notes,
    });

    res.json({
      success: true,
      recall: result.recall,
    });
  } catch (error: any) {
    console.error("Error in cancelRecall:", error);
    res.status(400).json({ error: error.message || "Failed to cancel recall" });
  }
};
