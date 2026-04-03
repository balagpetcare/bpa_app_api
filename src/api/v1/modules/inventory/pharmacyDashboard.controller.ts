import { Request, Response } from "express";
const pharmacyDashboardService = require("./pharmacyDashboard.service");

/**
 * GET /inventory/pharmacy-dashboard
 * Get consolidated pharmacy dashboard metrics
 */
exports.getPharmacyDashboard = async (req: Request, res: Response) => {
  try {
    const { orgId, branchId } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await pharmacyDashboardService.getPharmacyDashboard({
      orgId: Number(orgId),
      branchId: branchId ? Number(branchId) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in getPharmacyDashboard:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch pharmacy dashboard",
    });
  }
};

/**
 * GET /inventory/pharmacy-dashboard/trend
 * Get expiry trend (monthly expired qty for chart)
 */
exports.getExpiryTrend = async (req: Request, res: Response) => {
  try {
    const { orgId, months } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await pharmacyDashboardService.getExpiryTrend({
      orgId: Number(orgId),
      months: months ? Number(months) : 6,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in getExpiryTrend:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch expiry trend",
    });
  }
};

/**
 * GET /inventory/pharmacy-dashboard/alerts
 * Get pharmacy alert summary
 */
exports.getPharmacyAlerts = async (req: Request, res: Response) => {
  try {
    const { orgId, branchId } = req.query;

    if (!orgId) {
      return res.status(400).json({ error: "orgId is required" });
    }

    const result = await pharmacyDashboardService.getPharmacyAlerts({
      orgId: Number(orgId),
      branchId: branchId ? Number(branchId) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error in getPharmacyAlerts:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch pharmacy alerts",
    });
  }
};
