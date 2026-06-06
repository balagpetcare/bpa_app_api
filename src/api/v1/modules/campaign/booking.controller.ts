/**
 * Booking API Controller
 * HTTP handlers for booking management endpoints
 */

import { Request, Response, NextFunction } from "express";
import {
  createBookingSchema,
  walkInSchema,
  checkInSchema,
  cancelBookingSchema,
  availableSlotsQuerySchema,
  listCampaignBookingsQuerySchema,
} from "./campaign.validation";
import {
  createBooking,
  registerWalkIn,
  getBookingByRef,
  getBookingByQrToken,
  getBookingsByPhone,
  checkInBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
  mapBookingRecordToListRow,
} from "./booking.service";
import {
  queryCampaignBookings,
  parseBookingListFilters,
  getBookingFilterOptions,
} from "./bookingListFilters.service";
import { getAvailableSlots, getCampaignSlots, pickTimeLocale } from "./slot.service";
import { getLocationsWithAvailability } from "./location.service";
import { verifySession } from "./otp.service";
import { CampaignError, ValidationErrors } from "./campaign.errors";
import { formatDate, startOfDay, addDays, routeParam } from "./campaign.utils";

// ============================================================================
// Public Booking Endpoints
// ============================================================================

/**
 * GET /public/campaigns/:slug/availability
 * Get available locations and slots for a campaign
 */
export async function getAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = routeParam(req.params.campaignId);
    const { date } = req.query;

    const targetDate = date ? new Date(date as string) : new Date();
    const locations = await getLocationsWithAvailability(
      parseInt(campaignId, 10),
      targetDate
    );

    res.json({ success: true, data: locations });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /public/locations/:locationId/slots
 * Get available slots for a location
 */
export async function getLocationSlotsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = routeParam(req.params.locationId);
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfDay(new Date());
    const end = endDate ? new Date(endDate as string) : addDays(start, 14);

    const locale = pickTimeLocale(req.headers["accept-language"] as string | undefined);
    const slots = await getAvailableSlots(parseInt(locationId, 10), start, end, locale);

    res.json({ success: true, data: slots });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /public/bookings
 * Create a new booking (requires OTP session)
 */
export async function createBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Verify session token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw ValidationErrors.INVALID_INPUT("Authentication required");
    }

    const token = authHeader.slice(7);
    const session = await verifySession(token);

    if (!session.valid) {
      throw ValidationErrors.INVALID_INPUT("Invalid or expired session");
    }

    const data = createBookingSchema.parse(req.body);

    // Verify session phone matches booking phone
    const booking = await createBooking(data, session.phone);

    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /public/bookings/:ref
 * Get booking by reference (requires OTP session)
 */
export async function getBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ref = routeParam(req.params.ref);

    // Verify session
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw ValidationErrors.INVALID_INPUT("Authentication required");
    }

    const token = authHeader.slice(7);
    const session = await verifySession(token);

    if (!session.valid) {
      throw ValidationErrors.INVALID_INPUT("Invalid or expired session");
    }

    const booking = await getBookingByRef(ref.toUpperCase());

    // Verify ownership
    if (booking.owner.phone !== session.phone) {
      throw ValidationErrors.INVALID_INPUT("Booking not found");
    }

    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /public/my-bookings
 * Get user's bookings (requires OTP session)
 */
export async function getMyBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw ValidationErrors.INVALID_INPUT("Authentication required");
    }

    const token = authHeader.slice(7);
    const session = await verifySession(token);

    if (!session.valid) {
      throw ValidationErrors.INVALID_INPUT("Invalid or expired session");
    }

    const { campaignId } = req.query;
    const bookings = await getBookingsByPhone(
      session.phone!,
      campaignId ? parseInt(campaignId as string, 10) : undefined
    );

    res.json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /public/bookings/:ref/cancel
 * Cancel a booking (requires OTP session)
 */
export async function cancelBookingPublicHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ref = routeParam(req.params.ref);
    const data = cancelBookingSchema.parse(req.body);

    // Verify session
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw ValidationErrors.INVALID_INPUT("Authentication required");
    }

    const token = authHeader.slice(7);
    const session = await verifySession(token);

    if (!session.valid) {
      throw ValidationErrors.INVALID_INPUT("Invalid or expired session");
    }

    // Get booking and verify ownership
    const booking = await getBookingByRef(ref.toUpperCase());
    if (booking.owner.phone !== session.phone) {
      throw ValidationErrors.INVALID_INPUT("Booking not found");
    }

    await cancelBooking(booking.id, data.reason);

    res.json({ success: true, message: "Booking cancelled" });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Staff Booking Endpoints
// ============================================================================

/**
 * POST /staff/bookings/check-in
 * Check in a booking by QR or reference
 */
export async function checkInHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const data = checkInSchema.parse(req.body);
    const userId = (req as any).user?.id;

    const result = await checkInBooking(data.identifier, userId, data.locationId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: "CHECK_IN_FAILED", message: result.error },
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /staff/bookings/walk-in
 * Register a walk-in
 */
export async function registerWalkInHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const data = walkInSchema.parse(req.body);
    const userId = (req as any).user?.id;

    const booking = await registerWalkIn(data, userId);

    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /staff/bookings/:id
 * Get booking details for staff view
 */
export async function getBookingForStaffHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = routeParam(req.params.id);

    // Try to find by ref first, then by ID
    let booking;
    if (id.startsWith("VAC-")) {
      booking = await getBookingByRef(id);
    } else if (id.length === 32) {
      booking = await getBookingByQrToken(id);
    } else {
      booking = await getBookingByRef(id);
    }

    res.json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /staff/bookings/:id/no-show
 * Mark booking as no-show
 */
export async function markNoShowHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = routeParam(req.params.id);
    const userId = (req as any).user?.id;

    await markNoShow(parseInt(id, 10), userId);

    res.json({ success: true, message: "Marked as no-show" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /staff/bookings/:id/complete
 * Complete a booking
 */
export async function completeBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = routeParam(req.params.id);
    const userId = (req as any).user?.id;

    await completeBooking(parseInt(id, 10), userId);

    res.json({ success: true, message: "Booking completed" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /staff/bookings/:id/cancel
 * Cancel booking (staff)
 */
export async function cancelBookingStaffHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const id = routeParam(req.params.id);
    const data = cancelBookingSchema.parse(req.body);
    const userId = (req as any).user?.id;

    await cancelBooking(parseInt(id, 10), data.reason, userId);

    res.json({ success: true, message: "Booking cancelled" });
  } catch (error) {
    next(error);
  }
}

// ============================================================================
// Admin Booking Endpoints
// ============================================================================

/**
 * GET /admin/campaigns/:campaignId/bookings
 * List bookings for a campaign
 */
export async function listCampaignBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseInt(routeParam(req.params.campaignId), 10);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }

    listCampaignBookingsQuerySchema.parse(req.query);
    const filters = parseBookingListFilters(req.query as Record<string, unknown>, campaignId);
    const result = await queryCampaignBookings(filters);

    res.json({
      success: true,
      items: result.items.map(mapBookingRecordToListRow),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      summary: result.summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /admin/campaigns/:campaignId/bookings/filter-options
 * Distinct filter values from actual booking data.
 */
export async function getCampaignBookingFilterOptionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const campaignId = parseInt(routeParam(req.params.campaignId), 10);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ success: false, message: "Invalid campaign id" });
    }
    const data = await getBookingFilterOptions(campaignId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export default {
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
  getCampaignBookingFilterOptionsHandler,
};
