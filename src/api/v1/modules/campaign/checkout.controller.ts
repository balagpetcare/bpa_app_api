/**
 * Express checkout & claim HTTP handlers.
 */

import { Request, Response, NextFunction } from "express";
import {
  checkoutInitSchema,
  checkoutConfirmFreeSchema,
  claimBookingSchema,
} from "./campaign.validation";
import {
  initCheckout,
  confirmFreeCheckout,
  getCheckoutStatus,
  retryCheckoutPayment,
} from "./checkout.service";
import {
  checkoutInitDebug,
  paymentRetryDebug,
  bookingValidationDebug,
  publicErrorHandlerDebug,
} from "./checkoutDebug.util";
import { ZodError } from "zod";
import { claimBooking } from "./claim.service";
import { listBookableAreas, getRolloutRegionStats, resolveCampaignId } from "./rollout.service";
import { listPublicCampaignLocations } from "./location.service";
import { listCheckoutSessions } from "./checkout.service";
import { routeParam } from "./campaign.utils";

export async function getPublicCampaignLocationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const slug = routeParam(req.params.slug);
    const onlyAvailable = req.query.onlyAvailable === "true" || req.query.onlyAvailable === "1";
    const locations = await listPublicCampaignLocations(
      { campaignSlug: slug },
      { onlyAvailable }
    );
    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
}

export async function getBookingAreasHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = routeParam(req.params.slug);
    const campaignId = await resolveCampaignId({ campaignSlug: slug });
    const areas = await listBookableAreas(campaignId);
    res.json({ success: true, data: areas });
  } catch (error) {
    next(error);
  }
}

export async function checkoutInitHandler(req: Request, res: Response, next: NextFunction) {
  try {
    checkoutInitDebug("handler_request", { body: req.body });
    const data = checkoutInitSchema.parse(req.body);
    bookingValidationDebug("handler_validated", { campaignSlug: data.campaignSlug, catCount: data.catCount });
    const result = await initCheckout(data);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ZodError) {
      bookingValidationDebug("handler_zod_error", { issues: error.issues });
    } else {
      publicErrorHandlerDebug("handler_error", {
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    next(error);
  }
}

export async function checkoutRetryPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const checkoutId = routeParam(req.params.checkoutId);
    paymentRetryDebug("handler_request", { checkoutId, body: req.body });
    const result = await retryCheckoutPayment(checkoutId, {
      returnUrl: typeof req.body?.returnUrl === "string" ? req.body.returnUrl : undefined,
      cancelUrl: typeof req.body?.cancelUrl === "string" ? req.body.cancelUrl : undefined,
      paymentMethod: req.body?.paymentMethod,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    publicErrorHandlerDebug("retry_handler_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}

export async function checkoutConfirmFreeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { checkoutId } = checkoutConfirmFreeSchema.parse(req.body);
    const result = await confirmFreeCheckout(checkoutId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function checkoutStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const checkoutId = routeParam(req.params.checkoutId);
    const status = await getCheckoutStatus(checkoutId);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}

export async function claimBookingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = claimBookingSchema.parse(req.body);
    const booking = await claimBooking(data);
    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

export async function listCheckoutSessionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const campaignId = parseInt(routeParam(req.params.campaignId), 10);
    const sessions = await listCheckoutSessions(campaignId);
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
}

export async function rolloutRegionStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const regionId = parseInt(routeParam(req.params.regionId), 10);
    const stats = await getRolloutRegionStats(regionId);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}
