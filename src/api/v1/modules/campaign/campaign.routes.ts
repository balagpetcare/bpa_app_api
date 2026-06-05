/**
 * Campaign API Routes
 * 2026 Cat Flu + Rabies Vaccination Campaign
 * 
 * Route groups:
 * - /api/v1/campaign/public/* - Public endpoints (no auth required)
 * - /api/v1/campaign/auth/* - OTP authentication endpoints
 * - /api/v1/campaign/booking/* - Booking endpoints (OTP session required)
 * - /api/v1/campaign/staff/* - Staff endpoints (BPA auth required)
 * - /api/v1/campaign/admin/* - Admin endpoints (BPA auth + campaign admin role)
 */

import { Router } from "express";
import {
  getPublicCampaignsHandler,
  getPublicCampaignBySlugHandler,
  getPublicCampaignCountdownHandler,
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
} from "./campaign.controller";

import {
  getAvailabilityHandler,
  getLocationSlotsHandler,
  createBookingHandler,
  getBookingHandler,
  getMyBookingsHandler,
  cancelBookingPublicHandler,
  checkInHandler,
  registerWalkInHandler,
  getBookingForStaffHandler,
  markNoShowHandler,
  completeBookingHandler,
  cancelBookingStaffHandler,
  listCampaignBookingsHandler,
} from "./booking.controller";

import {
  getBookingAreasHandler,
  getPublicCampaignLocationsHandler,
  checkoutInitHandler,
  checkoutConfirmFreeHandler,
  checkoutStatusHandler,
  claimBookingHandler,
  listCheckoutSessionsHandler,
  rolloutRegionStatsHandler,
} from "./checkout.controller";

import { requestOtpSchema, verifyOtpSchema, paymentWebhookSchema } from "./campaign.validation";
import { requestOtp, verifyOtp, verifySession } from "./otp.service";
import { ValidationErrors } from "./campaign.errors";
import { recordVaccination, deferVaccination, skipVaccination, getVaccinationStats } from "./vaccination.service";
import { createLocation, listLocations, updateLocation, getLocationStats, getTodayQueue } from "./location.service";
import {
  createSlot,
  bulkCreateSlots,
  updateSlot,
  closeSlot,
  openSlot,
  listLocationSlots,
  pickTimeLocale,
} from "./slot.service";
import { parseRouteIdParam, startOfDay, addDays } from "./campaign.utils";
import { assignStaff, listCampaignStaff, updateStaffRole, removeStaff, getStaffStats } from "./staff.service";
import {
  recordVaccinationSchema,
  deferVaccinationSchema,
  createLocationSchema,
  updateLocationSchema,
  createSlotSchema,
  bulkCreateSlotsSchema,
  assignStaffSchema,
  updateStaffRoleSchema,
  createIncludedVaccineSchema,
  updateIncludedVaccineSchema,
  reorderIncludedVaccinesSchema,
} from "./campaign.validation";
import {
  createIncludedVaccine,
  deleteIncludedVaccine,
  listIncludedVaccinesForCampaign,
  reorderIncludedVaccines,
  updateIncludedVaccine,
} from "./campaignIncludedVaccine.service";
import {
  requireCampaignAdmin,
  requireCampaignStaff,
} from "./campaign.middleware";
import { handleVerificationRequest } from "./verification.service";
import { getCertificateData, generateCertificatePdf } from "./certificate.service";
import { processPaymentWebhook, createPaymentIntent, getPaymentStatus } from "./payment.service";
import { validateCampaignCoupon } from "./campaignCoupon.service";
import {
  handleBkashCallback,
  handleNagadCallback,
  handleSslCommerzIpn,
} from "./payment.webhooks.service";
import {
  getCampaignPaymentApiPrefix,
  getUnifiedPaymentApiPrefix,
  getActivePaymentProvider,
  getBkashConfig,
  getNagadConfig,
  getSslCommerzConfig,
  getAmarPayConfig,
} from "../../providers/paymentProvider.config";
import { validateBookingQr } from "./qr.service";
import { getBookingByRef } from "./booking.service";
import { smsDeliveryCallbackHandler } from "./sms.controller";
import { getCampaignSmsCostSummary } from "./smsCostMonitoring.service";
import {
  getSmsInfrastructureHealth,
  recoverStuckCampaignSmsLogs,
} from "./smsQueueRecovery.service";
import { getRecentSmsFailures } from "../../../../integrations/sms/smsGateway.service";
import {
  areaCheckSchema,
  createRolloutPhaseSchema,
  createRolloutRegionSchema,
  preRegisterSchema,
  updateRolloutPhaseSchema,
  updateRolloutRegionSchema,
  notifyPreRegisteredSchema,
} from "./rollout.validation";
import {
  checkAreaActive,
  createPreRegistration,
  createRolloutPhase,
  createRolloutRegion,
  getAreaDemandDashboard,
  getPreBookingDashboard,
  getPublicRoadmap,
  getRolloutDemandReports,
  getWaitingListDashboard,
  listBdDistricts,
  listBdDivisions,
  listBdUpazilas,
  listRolloutPhases,
  notifyPreRegisteredUsers,
  resolveCampaignId,
  updateRolloutPhase,
  updateRolloutRegion,
} from "./rollout.service";
import {
  upcomingCampaignsQuerySchema,
  locatorSearchSchema,
  discoveryScheduleQuerySchema,
  bdAreasQuerySchema,
} from "./discovery.validation";
import {
  getUpcomingCampaigns,
  searchCampaignLocator,
  getDiscoverySchedule,
  getPublicLiveStats,
  listBdAreas,
} from "./discovery.service";
import {
  getDemandIntelligenceHandler,
  getDemandHeatmapHandler,
} from "./demand-intelligence.controller";
import {
  getCampaignConfig,
  upsertCampaignConfig,
  getConfigHistory,
  getConfigVersion,
} from "./config.service";
import { campaignConfigSchema, campaignConfigHistoryQuerySchema } from "./config.validation";
import { getCampaignAnalyticsDashboard } from "./analytics.service";
import { getCampaignPlanningDashboard } from "./planning.service";
import { assignVenueToZoneBooking } from "./zoneAssignment.service";
import {
  listAdminCoverageZones,
  listBdAreasForCoverageZone,
} from "./coverageAdmin.service";
import { assignVenueToBookingSchema } from "./campaign.validation";
import {
  exportCampaignBookingsHandler,
  exportCampaignAnalyticsHandler,
} from "./export.controller";
import {
  listCampaignSmsLogs,
  listCampaignSmsTemplates,
  upsertCampaignSmsTemplate,
  sendBulkCampaignSms,
} from "./smsAdmin.service";

const router = Router();

// ============================================================================
// Public Routes (No Auth)
// ============================================================================

const publicRouter = Router();

// Campaign listing
publicRouter.get("/campaigns", getPublicCampaignsHandler);
publicRouter.get("/campaigns/:slug/countdown", getPublicCampaignCountdownHandler);
publicRouter.get("/campaigns/:slug/locations", getPublicCampaignLocationsHandler);
publicRouter.get("/campaigns/:slug", getPublicCampaignBySlugHandler);

// Availability
publicRouter.get("/campaigns/:campaignId/availability", getAvailabilityHandler);
publicRouter.get("/locations/:locationId/slots", getLocationSlotsHandler);

// Certificate verification (public)
publicRouter.get("/verify/:token", async (req, res, next) => {
  try {
    const result = await handleVerificationRequest(req.params.token, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
      source: "API",
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/certificates/:token", async (req, res, next) => {
  try {
    const data = await getCertificateData(req.params.token);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "CERTIFICATE_NOT_FOUND", message: "Certificate not found" },
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/certificates/:token/pdf", async (req, res, next) => {
  try {
    const pdf = await generateCertificatePdf(req.params.token);
    if (!pdf) {
      return res.status(404).json({
        success: false,
        error: { code: "CERTIFICATE_NOT_FOUND", message: "Certificate not found or PDF unavailable" },
      });
    }
    res.json({ success: true, data: pdf });
  } catch (error) {
    next(error);
  }
});

// SMS delivery status callback from gateway providers
publicRouter.post("/sms/delivery-callback", smsDeliveryCallbackHandler);

// SMS infrastructure health (no secrets exposed)
publicRouter.get("/sms/health", async (_req, res, next) => {
  try {
    const health = await getSmsInfrastructureHealth();
    res.json({ success: true, data: health });
  } catch (error) {
    next(error);
  }
});

// Campaign discovery (locator, schedule, upcoming)
publicRouter.get("/discovery/upcoming", async (req, res, next) => {
  try {
    const query = upcomingCampaignsQuerySchema.parse(req.query);
    const data = await getUpcomingCampaigns(query.window, {
      campaignId: query.campaignId,
      campaignSlug: query.campaignSlug,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/discovery/locator", async (req, res, next) => {
  try {
    const query = locatorSearchSchema.parse(req.query);
    const data = await searchCampaignLocator(query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/discovery/schedule", async (req, res, next) => {
  try {
    const query = discoveryScheduleQuerySchema.parse(req.query);
    const data = await getDiscoverySchedule(query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/discovery/demand-heatmap", getDemandHeatmapHandler);

publicRouter.get("/discovery/live-stats", async (req, res, next) => {
  try {
    const campaignId = await resolveCampaignId({
      campaignId: req.query.campaignId ? parseInt(String(req.query.campaignId), 10) : undefined,
      campaignSlug: req.query.slug as string | undefined,
    });
    const data = await getPublicLiveStats(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/discovery/areas", async (req, res, next) => {
  try {
    const query = bdAreasQuerySchema.parse(req.query);
    const data = await listBdAreas(query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// National rollout roadmap & pre-registration
publicRouter.get("/rollout/roadmap", async (req, res, next) => {
  try {
    const campaignId = await resolveCampaignId({
      campaignId: req.query.campaignId ? parseInt(String(req.query.campaignId), 10) : undefined,
      campaignSlug: req.query.slug as string | undefined,
    });
    const data = await getPublicRoadmap(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/rollout/divisions", async (_req, res, next) => {
  try {
    const data = await listBdDivisions();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/rollout/districts", async (req, res, next) => {
  try {
    const divisionId = parseInt(String(req.query.divisionId), 10);
    const data = await listBdDistricts(divisionId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/rollout/upazilas", async (req, res, next) => {
  try {
    const districtId = parseInt(String(req.query.districtId), 10);
    const data = await listBdUpazilas(districtId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/rollout/area-check", async (req, res, next) => {
  try {
    const body = areaCheckSchema.parse(req.body);
    const campaignId = await resolveCampaignId(body);
    const data = await checkAreaActive(
      campaignId,
      body.divisionId,
      body.districtId,
      body.upazilaId
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/pre-register", async (req, res, next) => {
  try {
    const body = preRegisterSchema.parse(req.body);
    const campaignId = await resolveCampaignId(body);
    const data = await createPreRegistration({
      campaignId,
      divisionId: body.divisionId,
      districtId: body.districtId,
      upazilaId: body.upazilaId,
      phone: body.phone,
      catCount: body.catCount,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Express checkout (3-step booking — no OTP)
publicRouter.get("/campaigns/:slug/booking-areas", getBookingAreasHandler);

publicRouter.get("/dhaka/city-corporations", async (_req, res, next) => {
  try {
    const { listDhakaCityCorporationsForBooking } = await import("./dhakaBooking.service");
    const data = await listDhakaCityCorporationsForBooking();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/dhaka/city-corporations/:code/booking-areas", async (req, res, next) => {
  try {
    const { listDhakaBookingAreas } = await import("./dhakaBooking.service");
    const code = String(req.params.code || "").trim();
    const data = await listDhakaBookingAreas(code);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/coverage-zones", async (_req, res, next) => {
  try {
    const data = await listAdminCoverageZones();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/coverage-zones/:zoneId/bd-areas", async (req, res, next) => {
  try {
    const zoneId = parseInt(String(req.params.zoneId), 10);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const data = await listBdAreasForCoverageZone(zoneId, { q, limit: 100 });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/checkout/init", checkoutInitHandler);
publicRouter.post("/checkout/confirm-free", checkoutConfirmFreeHandler);
publicRouter.get("/checkout/:checkoutId/status", checkoutStatusHandler);

publicRouter.get("/bookings/:ref/tickets", async (req, res, next) => {
  try {
    const { getTicketsByBookingRef } = await import("./ticket.service");
    const ref = String(req.params.ref || "").trim();
    const includeQr = req.query.qr === "1" || req.query.qr === "true";
    const data = await getTicketsByBookingRef(ref, { includeQr });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/tickets/:token", async (req, res, next) => {
  try {
    const { getTicketByToken } = await import("./ticket.service");
    const token = String(req.params.token || "").trim();
    const data = await getTicketByToken(token);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" },
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/tickets/:token/qr", async (req, res, next) => {
  try {
    const { getTicketByToken } = await import("./ticket.service");
    const token = String(req.params.token || "").trim();
    const data = await getTicketByToken(token, { includeQr: true });
    if (!data) {
      return res.status(404).json({
        success: false,
        error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" },
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/booking/claim", claimBookingHandler);

// Coupon validation (public — same rules as payment charge)
publicRouter.post("/coupons/validate", async (req, res, next) => {
  try {
    const code = String(req.body?.code || "");
    const result = validateCampaignCoupon(code);
    if (result.ok === false) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_COUPON", message: result.error },
      });
    }
    res.json({ success: true, data: result.coupon });
  } catch (error) {
    next(error);
  }
});

// Production callback URL registry (for DevOps / gateway dashboards)
publicRouter.get("/payments/callback-urls", (_req, res) => {
  const unified = getUnifiedPaymentApiPrefix();
  res.json({
    success: true,
    data: {
      activeProvider: getActivePaymentProvider(),
      unifiedApiPrefix: unified,
      legacyCampaignPrefix: getCampaignPaymentApiPrefix(),
      bkash: getBkashConfig().callbackUrl,
      nagad: getNagadConfig().callbackUrl,
      sslcommerz: {
        success: getSslCommerzConfig().successUrl,
        fail: getSslCommerzConfig().failUrl,
        cancel: getSslCommerzConfig().cancelUrl,
        ipn: getSslCommerzConfig().ipnUrl,
      },
      amarpay: { ipn: getAmarPayConfig().ipnUrl },
      genericWebhook: `${unified}/webhook`,
    },
  });
});

// bKash execute callback (register this URL in bKash merchant panel)
publicRouter.get("/payments/bkash/callback", async (req, res, next) => {
  try {
    const result = await handleBkashCallback(req.query as Record<string, string>);
    if (!result.success) {
      const failBase = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
      const failUrl = failBase
        ? `${failBase.replace(/\/+$/, "")}/book/payment/failed`
        : "/book/payment/failed";
      return res.redirect(302, failUrl);
    }
    const okBase = process.env.CAMPAIGN_LANDING_URL || process.env.APP_URL || "";
    const invoice = req.query.merchantInvoiceNumber || req.query.merchantInvoice;
    const bookingRef = invoice
      ? String(invoice).replace(/^CAMP-/i, "")
      : String(req.query.ref || "");
    const successPath = bookingRef
      ? `/book/payment/success?ref=${encodeURIComponent(bookingRef)}`
      : "/book/payment/success";
    res.redirect(302, okBase ? `${okBase.replace(/\/+$/, "")}${successPath}` : successPath);
  } catch (error) {
    next(error);
  }
});

// Nagad signed callback
publicRouter.post("/payments/nagad/callback", async (req, res, next) => {
  try {
    const result = await handleNagadCallback(req.body || {});
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

// SSLCommerz IPN
publicRouter.post("/payments/sslcommerz/ipn", async (req, res, next) => {
  try {
    const result = await handleSslCommerzIpn(req.body || {});
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

// Generic payment webhook (idempotent) — provider adapters or internal relay
publicRouter.post("/payments/webhook", async (req, res, next) => {
  try {
    const webhookSecret = process.env.CAMPAIGN_PAYMENT_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = req.headers["x-campaign-payment-secret"];
      if (provided !== webhookSecret) {
        return res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid payment webhook secret" },
        });
      }
    }

    const data = paymentWebhookSchema.parse(req.body);
    const result = await processPaymentWebhook({
      provider: data.provider || "unknown",
      transactionId: data.transactionId,
      status: data.status,
      amount: data.amount,
      metadata: data.metadata,
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: { code: "ORDER_NOT_FOUND", message: "Payment order not found for transaction" },
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.use("/public", publicRouter);

// ============================================================================
// OTP Authentication Routes
// ============================================================================

const authRouter = Router();

// Request OTP
authRouter.post("/request-otp", async (req, res, next) => {
  try {
    const data = requestOtpSchema.parse(req.body);
    const result = await requestOtp(data.phone, data.purpose);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// Verify OTP
authRouter.post("/verify-otp", async (req, res, next) => {
  try {
    const data = verifyOtpSchema.parse(req.body);
    const result = await verifyOtp(data.phone, data.otp, data.purpose);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.use("/auth", authRouter);

// ============================================================================
// Booking Routes (OTP Session Required)
// ============================================================================

const bookingRouter = Router();

// Create booking
bookingRouter.post("/", createBookingHandler);

// Get user's bookings
bookingRouter.get("/my", getMyBookingsHandler);

async function requireOtpSession(req: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw ValidationErrors.INVALID_INPUT("Session token required");
  const session = await verifySession(token);
  if (!session.valid) throw ValidationErrors.INVALID_INPUT("Invalid or expired session");
  return session;
}

// Payment (before /:ref)
bookingRouter.post("/:ref/payment", async (req, res, next) => {
  try {
    const session = await requireOtpSession(req);
    const { method, returnUrl, cancelUrl, couponCode } = req.body;
    const booking = await getBookingByRef(String(req.params.ref).toUpperCase());
    if (booking.owner.phone !== session.phone) {
      throw ValidationErrors.INVALID_INPUT("Booking does not belong to this session");
    }
    const result = await createPaymentIntent({
      bookingId: booking.id,
      method: method || "BKASH",
      returnUrl,
      cancelUrl,
      couponCode: couponCode ? String(couponCode).trim() : undefined,
    });
    res.json({
      success: result.success,
      data: result,
      error: result.error ? { message: result.error } : undefined,
    });
  } catch (error) {
    next(error);
  }
});

bookingRouter.get("/:ref/payment-status", async (req, res, next) => {
  try {
    const session = await requireOtpSession(req);
    const booking = await getBookingByRef(String(req.params.ref).toUpperCase());
    if (booking.owner.phone !== session.phone) {
      throw ValidationErrors.INVALID_INPUT("Booking does not belong to this session");
    }
    const status = await getPaymentStatus(booking.id);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

// Get booking by reference
bookingRouter.get("/:ref", getBookingHandler);

// Cancel booking
bookingRouter.post("/:ref/cancel", cancelBookingPublicHandler);

router.use("/booking", bookingRouter);

// ============================================================================
// Staff Routes (BPA Auth + CampaignStaff RBAC)
// ============================================================================

const staffRouter = Router();

// Check-in
staffRouter.post("/check-in", ...requireCampaignStaff("canCheckIn"), checkInHandler);

// Walk-in registration
staffRouter.post("/walk-in", ...requireCampaignStaff("canRegisterWalkIn"), registerWalkInHandler);

// Booking management
staffRouter.get("/bookings/:id", ...requireCampaignStaff("canCheckIn"), getBookingForStaffHandler);
staffRouter.post("/bookings/:id/no-show", ...requireCampaignStaff("canManageQueue"), markNoShowHandler);
staffRouter.post("/bookings/:id/complete", ...requireCampaignStaff("canRecordVaccination"), completeBookingHandler);
staffRouter.post("/bookings/:id/cancel", ...requireCampaignStaff("canCheckIn"), cancelBookingStaffHandler);

// QR validate (staff)
staffRouter.post("/qr/validate", ...requireCampaignStaff("canCheckIn"), async (req, res, next) => {
  try {
    const { token } = req.body;
    const result = await validateBookingQr(token);
    res.json({ success: result.valid, data: result });
  } catch (error) {
    next(error);
  }
});

// Queue
staffRouter.get("/locations/:locationId/queue", ...requireCampaignStaff("canManageQueue"), async (req, res, next) => {
  try {
    const { locationId } = req.params;
    const queue = await getTodayQueue(parseInt(locationId, 10));
    res.json({ success: true, data: queue });
  } catch (error) {
    next(error);
  }
});

// Vaccination
staffRouter.post("/vaccinations/record", ...requireCampaignStaff("canRecordVaccination"), async (req, res, next) => {
  try {
    const data = recordVaccinationSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const result = await recordVaccination({ ...data, administeredByUserId: userId });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

staffRouter.post("/vaccinations/defer", ...requireCampaignStaff("canRecordVaccination"), async (req, res, next) => {
  try {
    const data = deferVaccinationSchema.parse(req.body);
    const userId = (req as any).user?.id;
    await deferVaccination(data.campaignPetId, data.reason, userId);
    res.json({ success: true, message: "Vaccination deferred" });
  } catch (error) {
    next(error);
  }
});

staffRouter.post("/vaccinations/skip", ...requireCampaignStaff("canRecordVaccination"), async (req, res, next) => {
  try {
    const data = deferVaccinationSchema.parse(req.body);
    const userId = (req as any).user?.id;
    await skipVaccination(data.campaignPetId, data.reason, userId);
    res.json({ success: true, message: "Vaccination skipped" });
  } catch (error) {
    next(error);
  }
});

router.use("/staff", staffRouter);

// ============================================================================
// Admin Routes (BPA Auth + campaign.manage)
// ============================================================================

const adminRouter = Router();
adminRouter.use(...requireCampaignAdmin);

// Campaign CRUD
adminRouter.post("/campaigns", createCampaignHandler);
adminRouter.get("/campaigns", listCampaignsHandler);
adminRouter.get("/campaigns/:id", getCampaignHandler);
adminRouter.patch("/campaigns/:id", updateCampaignHandler);
adminRouter.post("/campaigns/:id/activate", activateCampaignHandler);
adminRouter.post("/campaigns/:id/pause", pauseCampaignHandler);
adminRouter.post("/campaigns/:id/complete", completeCampaignHandler);
adminRouter.post("/campaigns/:id/cancel", cancelCampaignHandler);

// Campaign stats
adminRouter.get("/campaigns/:id/stats", getCampaignStatsHandler);
adminRouter.get("/campaigns/:id/daily-summary", getDailySummaryHandler);
adminRouter.get("/campaigns/:id/vaccination-stats", async (req, res, next) => {
  try {
    const { id } = req.params;
    const stats = await getVaccinationStats(parseInt(id, 10));
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// Bookings
adminRouter.get("/campaigns/:campaignId/bookings", listCampaignBookingsHandler);
adminRouter.get("/campaigns/:campaignId/bookings/export", exportCampaignBookingsHandler);

// SMS ops: cost summary, queue recovery, recent failures
adminRouter.get("/campaigns/:campaignId/sms/cost-summary", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const summary = await getCampaignSmsCostSummary({ campaignId });
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/campaigns/:campaignId/sms/recover-stuck", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const result = await recoverStuckCampaignSmsLogs({ campaignId });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/sms/logs", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const page = parseInt(String(req.query.page || "1"), 10);
    const pageSize = parseInt(String(req.query.pageSize || "25"), 10);
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await listCampaignSmsLogs({ campaignId, page, pageSize, status });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/sms/templates", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await listCampaignSmsTemplates(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/campaigns/:campaignId/sms/templates", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const { code, template, isActive } = req.body as {
      code?: string;
      template?: string;
      isActive?: boolean;
    };
    if (!code || !template) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "code and template are required" },
      });
    }
    const data = await upsertCampaignSmsTemplate({
      campaignId,
      code,
      template,
      isActive,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/campaigns/:campaignId/sms/bulk", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const body = req.body as {
      message?: string;
      phones?: string[];
      sendToAll?: boolean;
      bookingStatus?: string;
      locationIds?: number[];
      bookingDate?: string;
      dryRun?: boolean;
    };
    const locationIds = Array.isArray(body.locationIds)
      ? body.locationIds.map((id) => parseInt(String(id), 10)).filter((n) => Number.isFinite(n))
      : undefined;
    const data = await sendBulkCampaignSms({
      campaignId,
      message: body.message ?? "",
      phones: body.phones,
      sendToAll: body.sendToAll === true,
      bookingStatus: body.bookingStatus,
      locationIds: locationIds?.length ? locationIds : undefined,
      bookingDate: body.bookingDate,
      dryRun: body.dryRun === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/sms/recent-failures", async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(String(req.query.limit || "50"), 10) || 50);
    res.json({ success: true, data: getRecentSmsFailures(limit) });
  } catch (error) {
    next(error);
  }
});

// Coverage master (Dhaka metro — for location editor)
adminRouter.get("/coverage-zones", async (_req, res, next) => {
  try {
    const data = await listAdminCoverageZones();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/coverage-zones/:zoneId/bd-areas", async (req, res, next) => {
  try {
    const zoneId = parseInt(String(req.params.zoneId), 10);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const data = await listBdAreasForCoverageZone(zoneId, { q });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Locations
adminRouter.post("/locations", async (req, res, next) => {
  try {
    const data = createLocationSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const location = await createLocation(data, userId);
    res.status(201).json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/locations", async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { includeInactive } = req.query;
    const locations = await listLocations(
      parseInt(campaignId, 10),
      includeInactive === "true"
    );
    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/locations/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateLocationSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const location = await updateLocation(parseInt(id, 10), data, userId);
    res.json({ success: true, data: location });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/locations/:locationId/slots", async (req, res, next) => {
  try {
    const locationId = parseRouteIdParam("locationId", req.params.locationId, "location ID");
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(String(startDate)) : startOfDay(new Date());
    const end = endDate ? new Date(String(endDate)) : addDays(start, 14);
    const locale = pickTimeLocale(req.headers["accept-language"] as string | undefined);
    const slots = await listLocationSlots(locationId, start, end, locale);
    res.json({ success: true, data: slots });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/locations/:id/stats", async (req, res, next) => {
  try {
    const { id } = req.params;
    const stats = await getLocationStats(parseInt(id, 10));
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// Included vaccines (branded display for landing / booking)
adminRouter.get("/campaigns/:campaignId/included-vaccines", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const includeInactive = req.query.includeInactive === "true";
    const data = await listIncludedVaccinesForCampaign(campaignId, { includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/campaigns/:campaignId/included-vaccines", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const body = createIncludedVaccineSchema.parse(req.body);
    const userId = (req as { user?: { id?: number } }).user?.id;
    const data = await createIncludedVaccine(campaignId, body, userId);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/campaigns/:campaignId/included-vaccines/:vaccineId", async (req, res, next) => {
  try {
    const vaccineId = parseInt(req.params.vaccineId, 10);
    const body = updateIncludedVaccineSchema.parse(req.body);
    const userId = (req as { user?: { id?: number } }).user?.id;
    const data = await updateIncludedVaccine(vaccineId, body, userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/campaigns/:campaignId/included-vaccines/:vaccineId", async (req, res, next) => {
  try {
    const vaccineId = parseInt(req.params.vaccineId, 10);
    const userId = (req as { user?: { id?: number } }).user?.id;
    const data = await deleteIncludedVaccine(vaccineId, userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/campaigns/:campaignId/included-vaccines/reorder", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const { orderedIds } = reorderIncludedVaccinesSchema.parse(req.body);
    const userId = (req as { user?: { id?: number } }).user?.id;
    const data = await reorderIncludedVaccines(campaignId, orderedIds, userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Slots
adminRouter.post("/slots", async (req, res, next) => {
  try {
    const data = createSlotSchema.parse(req.body);
    const slot = await createSlot(data as import("./campaign.types").CreateSlotInput);
    res.status(201).json({ success: true, data: slot });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/slots/bulk", async (req, res, next) => {
  try {
    const data = bulkCreateSlotsSchema.parse(req.body);
    const result = await bulkCreateSlots(data as import("./campaign.types").BulkCreateSlotsInput);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/slots/:id", async (req, res, next) => {
  try {
    const slotId = parseRouteIdParam("id", req.params.id, "slot ID");
    const { capacity, status } = req.body;
    console.info(`[CampaignSlot] PATCH /slots/${slotId}`, { capacity, status });
    const slot = await updateSlot(slotId, { capacity, status });
    res.json({ success: true, data: slot });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/slots/:id/close", async (req, res, next) => {
  try {
    const slotId = parseRouteIdParam("id", req.params.id, "slot ID");
    console.info(`[CampaignSlot] POST /slots/${slotId}/close`, { slotId });
    const slot = await closeSlot(slotId);
    res.json({ success: true, data: slot });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/slots/:id/open", async (req, res, next) => {
  try {
    const slotId = parseRouteIdParam("id", req.params.id, "slot ID");
    console.info(`[CampaignSlot] POST /slots/${slotId}/open`, { slotId });
    const slot = await openSlot(slotId);
    res.json({ success: true, data: slot });
  } catch (error) {
    next(error);
  }
});

// Staff
adminRouter.post("/staff", async (req, res, next) => {
  try {
    const data = assignStaffSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const staff = await assignStaff(data, userId);
    res.status(201).json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/staff", async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const staff = await listCampaignStaff(parseInt(campaignId, 10));
    res.json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/staff/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateStaffRoleSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const staff = await updateStaffRole(parseInt(id, 10), data.role, userId);
    res.json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/staff/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    await removeStaff(parseInt(id, 10), userId);
    res.json({ success: true, message: "Staff removed" });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/staff-stats", async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const stats = await getStaffStats(parseInt(campaignId, 10));
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// National rollout engine (admin)
adminRouter.get("/campaigns/:campaignId/rollout/phases", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await listRolloutPhases(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/rollout/phases", async (req, res, next) => {
  try {
    const data = createRolloutPhaseSchema.parse(req.body);
    const phase = await createRolloutPhase(data);
    res.status(201).json({ success: true, data: phase });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/rollout/phases/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = updateRolloutPhaseSchema.parse(req.body);
    const phase = await updateRolloutPhase(id, body);
    res.json({ success: true, data: phase });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/rollout/regions", async (req, res, next) => {
  try {
    const data = createRolloutRegionSchema.parse(req.body);
    const region = await createRolloutRegion(data);
    res.status(201).json({ success: true, data: region });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/rollout/regions/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = updateRolloutRegionSchema.parse(req.body);
    const region = await updateRolloutRegion(id, body);
    res.json({ success: true, data: region });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/rollout/regions/:regionId/stats", rolloutRegionStatsHandler);

adminRouter.get("/campaigns/:campaignId/checkout-sessions", listCheckoutSessionsHandler);

adminRouter.get("/campaigns/:campaignId/rollout/dashboard/pre-bookings", async (req, res, next) => {
  try {
    const data = await getPreBookingDashboard(parseInt(req.params.campaignId, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/rollout/dashboard/area-demand", async (req, res, next) => {
  try {
    const data = await getAreaDemandDashboard(parseInt(req.params.campaignId, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/rollout/dashboard/waiting-list", async (req, res, next) => {
  try {
    const data = await getWaitingListDashboard(parseInt(req.params.campaignId, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/rollout/reports/demand", async (req, res, next) => {
  try {
    const data = await getRolloutDemandReports(parseInt(req.params.campaignId, 10));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Demand intelligence
adminRouter.get("/campaigns/:campaignId/demand-intelligence", getDemandIntelligenceHandler);

adminRouter.post("/campaigns/:campaignId/rollout/notify-pre-registered", async (req, res, next) => {
  try {
    const body = notifyPreRegisteredSchema.parse({
      ...req.body,
      campaignId: parseInt(req.params.campaignId, 10),
    });
    const data = await notifyPreRegisteredUsers(body);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Campaign Config Engine
adminRouter.get("/campaigns/:campaignId/config", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await getCampaignConfig(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/campaigns/:campaignId/config", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const body = campaignConfigSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const data = await upsertCampaignConfig(campaignId, body, userId, req.body.changeReason);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/config/history", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await getConfigHistory(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/config/history/:version", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const version = parseInt(req.params.version, 10);
    const data = await getConfigVersion(campaignId, version);
    if (!data) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Config version not found" } });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Campaign Analytics Dashboard
adminRouter.get("/campaigns/:campaignId/analytics", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await getCampaignAnalyticsDashboard(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/planning", async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.campaignId, 10);
    const data = await getCampaignPlanningDashboard(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/bookings/:bookingId/assign-venue", async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.bookingId, 10);
    const body = assignVenueToBookingSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const data = await assignVenueToZoneBooking(bookingId, body, userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/campaigns/:campaignId/analytics/export", exportCampaignAnalyticsHandler);

router.use("/admin", adminRouter);

// ============================================================================
// Error Handler
// ============================================================================

router.use(campaignErrorHandler);

module.exports = router;
export default router;
