/**
 * Campaign API Controller
 * HTTP handlers for campaign management endpoints
 */

import { Request, Response, NextFunction } from "express";
import {
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsQuerySchema,
} from "./campaign.validation";
import {
  createCampaign,
  getCampaignById,
  getCampaignBySlug,
  getCampaignCountdownBySlug,
  getPublicCampaigns,
  listCampaigns,
  updateCampaign,
  activateCampaign,
  pauseCampaign,
  completeCampaign,
  cancelCampaign,
  getCampaignStats,
  getDailySummary,
} from "./campaign.service";
import { CampaignError } from "./campaign.errors";
import type { CreateCampaignInput } from "./campaign.types";
import { routeParam } from "./campaign.utils";
import { getCampaignConfig, getCampaignConfigOrNull } from "./config.service";
import { serializePublicCampaignPricing } from "./campaignPricingPresentation.service";

// ============================================================================
// Public Endpoints
// ============================================================================

/**
 * GET /public/campaigns
 * List active public campaigns
 */
export async function getPublicCampaignsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaigns = await getPublicCampaigns();
    res.json({
      success: true,
      data: campaigns.map((c) => serializePublicCampaignPricing(c)),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /public/campaigns/:slug
 * Get campaign by slug (public view)
 */
export async function getPublicCampaignBySlugHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const slug = routeParam(req.params.slug);
    const campaign = await getCampaignBySlug(slug);

    // Only return if public and active
    if (campaign.visibility !== "PUBLIC" || campaign.status !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        error: { code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" },
      });
    }

    const configRow = await getCampaignConfigOrNull(campaign.id);
    const config = configRow
      ? {
          bookingEnabled: configRow.bookingEnabled,
          onlinePaymentEnabled: configRow.onlinePaymentEnabled,
          payAtVenueEnabled: configRow.payAtVenueEnabled,
          walkInAllowed: configRow.walkInAllowed,
          slotRequired: configRow.slotRequired,
          maxCatsPerBooking: configRow.maxCatsPerBooking,
          showRemainingSlots: configRow.showRemainingSlots,
          lateBookingAllowed: configRow.lateBookingAllowed,
        }
      : null;

    res.json({
      success: true,
      data: { ...serializePublicCampaignPricing(campaign), config },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPublicCampaignCountdownHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const slug = routeParam(req.params.slug);
    const countdown = await getCampaignCountdownBySlug(slug);
    res.json({ success: true, data: countdown });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Admin Endpoints
// ============================================================================

/**
 * POST /admin/campaigns
 * Create a new campaign
 */
export async function createCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const data = createCampaignSchema.parse(req.body);
    const userId = (req as any).user?.id;

    const campaign = await createCampaign(data as CreateCampaignInput, userId);

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/campaigns
 * List campaigns with filters
 */
export async function listCampaignsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const params = listCampaignsQuerySchema.parse(req.query);
    const result = await listCampaigns(params);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/campaigns/:id
 * Get campaign by ID
 */
export async function getCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseInt(routeParam(req.params.id), 10);
    const campaign = await getCampaignById(campaignId);
    const config = await getCampaignConfig(campaignId);

    res.json({
      success: true,
      data: {
        ...serializePublicCampaignPricing(campaign),
        config,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /admin/campaigns/:id
 * Update campaign
 */
export async function updateCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const data = updateCampaignSchema.parse(req.body);
    const userId = (req as any).user?.id;

    const campaign = await updateCampaign(parseInt(routeParam(req.params.id), 10), data, userId);

    res.json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/campaigns/:id/activate
 * Activate campaign
 */
export async function activateCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.id;

    const campaign = await activateCampaign(parseInt(routeParam(req.params.id), 10), userId);

    res.json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/campaigns/:id/pause
 * Pause campaign
 */
export async function pauseCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.id;

    const campaign = await pauseCampaign(parseInt(routeParam(req.params.id), 10), userId);

    res.json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/campaigns/:id/complete
 * Complete campaign
 */
export async function completeCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.id;

    const campaign = await completeCampaign(parseInt(routeParam(req.params.id), 10), userId);

    res.json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /admin/campaigns/:id/cancel
 * Cancel campaign
 */
export async function cancelCampaignHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = (req as any).user?.id;

    const campaign = await cancelCampaign(parseInt(routeParam(req.params.id), 10), userId);

    res.json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/campaigns/:id/stats
 * Get campaign statistics
 */
export async function getCampaignStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const stats = await getCampaignStats(parseInt(routeParam(req.params.id), 10));

    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/campaigns/:id/daily-summary
 * Get daily summary for campaign
 */
export async function getDailySummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { date } = req.query;

    const summaryDate = date ? new Date(date as string) : new Date();
    const summary = await getDailySummary(parseInt(routeParam(req.params.id), 10), summaryDate);

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Error Handler Middleware
// ============================================================================

export function campaignErrorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (error instanceof CampaignError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  // Zod validation errors
  if (error.name === "ZodError") {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: (error as any).errors,
      },
    });
  }

  // Pass to default error handler
  next(error);
}

export default {
  getPublicCampaignsHandler,
  getPublicCampaignBySlugHandler,
  createCampaignHandler,
  listCampaignsHandler,
  getCampaignHandler,
  updateCampaignHandler,
  activateCampaignHandler,
  pauseCampaignHandler,
  completeCampaignHandler,
  cancelCampaignHandler,
  getCampaignStatsHandler,
  getDailySummaryHandler,
  campaignErrorHandler,
};
