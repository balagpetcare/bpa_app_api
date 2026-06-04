/**
 * HTTP handlers — Vaccination Demand Forecasting & Rollout Planning.
 */

import type { NextFunction, Request, Response } from "express";
import { parseRouteIdParam, routeParam } from "./campaign.utils";
import { getDemandIntelligence } from "./demand-intelligence.service";
import { resolveCampaignId } from "./rollout.service";

export async function getDemandIntelligenceHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseRouteIdParam("campaignId", req.params.campaignId, "campaign ID");
    const data = await getDemandIntelligence(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getDemandHeatmapHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const campaignId = await resolveCampaignId({
      campaignId: req.query.campaignId ? parseInt(String(req.query.campaignId), 10) : undefined,
      campaignSlug: routeParam(req.query.slug as string | string[] | undefined) || undefined,
    });
    const level = String(req.query.level || "district");
    const intel = await getDemandIntelligence(campaignId);
    const heatmap =
      level === "division"
        ? intel.geographic.heatmap.division
        : level === "upazila" || level === "city"
          ? intel.geographic.heatmap.upazila
          : level === "area"
            ? intel.geographic.heatmap.area
            : intel.geographic.heatmap.district;
    res.json({
      success: true,
      data: { level, points: heatmap, generatedAt: intel.generatedAt },
    });
  } catch (error) {
    next(error);
  }
}
