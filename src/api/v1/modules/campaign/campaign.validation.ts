/**
 * Campaign Module Validation Schemas
 * Zod schemas for request validation
 */

import { z } from "zod";

// ============================================================================
// Common Validators
// ============================================================================

const bdPhoneRegex = /^(\+?880)?01[3-9]\d{8}$/;

export const phoneSchema = z.string().regex(bdPhoneRegex, "Invalid Bangladesh phone number");

export const dateSchema = z.string().transform((val) => new Date(val)).or(z.date());

export const timeSchema = z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// Campaign Schemas
// ============================================================================

export const createCampaignSchema = z.object({
  name: z.string().min(3).max(200),
  slug: z.string().min(3).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(2000).optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  bookingStartAt: dateSchema.nullish(),
  bookingEndAt: dateSchema.nullish(),
  countdownEnabled: z.boolean().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  pricingType: z.enum(["FREE", "PAID", "DONATION"]).optional(),
  priceAmount: z.number().min(0).optional(),
  vaccineCost: z.number().min(0).optional(),
  serviceCharge: z.number().min(0).optional(),
  packageFeatures: z.array(z.string().min(1).max(300)).max(30).optional(),
  maxPetsPerBooking: z.number().int().min(1).max(10).optional(),
  advanceBookingDays: z.number().int().min(1).max(90).optional(),
  minAdvanceHours: z.number().int().min(0).max(168).optional(),
  allowWalkIns: z.boolean().optional(),
  walkInQuotaPercent: z.number().int().min(0).max(100).optional(),
  targetVaccinations: z.number().int().min(0).optional(),
  organizerId: z.number().int().optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial().omit({ slug: true });

export const campaignStatusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]),
});

// ============================================================================
// Location Schemas
// ============================================================================

export const createLocationSchema = z.object({
  campaignId: z.number().int(),
  name: z.string().min(2).max(200),
  address: z.string().max(500).optional(),
  addressJson: z
    .object({
      division: z.string().optional(),
      district: z.string().optional(),
      upazila: z.string().optional(),
      area: z.string().optional(),
      bookingArea: z.string().optional(),
      coverageZoneId: z.number().int().optional(),
      bdAreaId: z.number().int().optional(),
      bdAreaCode: z.string().optional(),
    })
    .optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  contactName: z.string().max(100).optional(),
  contactPhone: phoneSchema.optional(),
  dailyCapacity: z.number().int().min(1).max(10000).optional(),
});

export const updateLocationSchema = createLocationSchema.partial().omit({ campaignId: true }).extend({
  isActive: z.boolean().optional(),
});

// ============================================================================
// Slot Schemas
// ============================================================================

const slotSessionFieldsSchema = {
  sessionName: z.string().min(1).max(120).optional(),
  checkInStartTime: timeSchema.optional(),
  bookingCutoffTime: timeSchema.optional(),
};

export const slotRepeatPatternSchema = z.enum(["DAILY", "WEEKDAYS", "WEEKENDS", "CUSTOM"]);

export const createSlotSchema = z.object({
  locationId: z.number().int(),
  date: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  capacity: z.number().int().min(1).max(1000).optional(),
  ...slotSessionFieldsSchema,
});

export const bulkCreateSlotsSchema = z.object({
  locationId: z.number().int(),
  startDate: dateSchema,
  endDate: dateSchema,
  slots: z
    .array(
      z.object({
        startTime: timeSchema,
        endTime: timeSchema,
        capacity: z.number().int().min(1).max(1000).optional(),
        ...slotSessionFieldsSchema,
      })
    )
    .min(1)
    .max(10),
  ...slotSessionFieldsSchema,
  excludeWeekends: z.boolean().optional(),
  repeatPattern: slotRepeatPatternSchema.optional(),
  customDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export const updateSlotSchema = z.object({
  capacity: z.number().int().min(1).max(1000).optional(),
  status: z.enum(["OPEN", "FULL", "CLOSED", "CANCELLED"]).optional(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  sessionName: z.string().min(1).max(120).optional(),
  checkInStartTime: timeSchema.nullable().optional(),
  bookingCutoffTime: timeSchema.nullable().optional(),
});

// ============================================================================
// Booking Schemas
// ============================================================================

export const createBookingSchema = z.object({
  campaignId: z.number().int(),
  locationId: z.number().int(),
  slotId: z.number().int(),
  owner: z.object({
    phone: phoneSchema,
    name: z.string().min(2).max(100),
    address: z.object({
      division: z.string().optional(),
      district: z.string().optional(),
      area: z.string().optional(),
    }).optional(),
  }),
  pets: z.array(z.object({
    name: z.string().min(1).max(100),
    animalTypeId: z.number().int().optional(),
    breedId: z.number().int().optional(),
    gender: z.enum(["MALE", "FEMALE", "UNKNOWN"]).optional(),
    ageMonths: z.number().int().min(0).max(360).optional(),
    colorDescription: z.string().max(100).optional(),
  })).min(1).max(10),
});

export const walkInSchema = z.object({
  campaignId: z.number().int(),
  locationId: z.number().int(),
  owner: z.object({
    phone: phoneSchema,
    name: z.string().min(2).max(100),
  }),
  pets: z.array(z.object({
    name: z.string().min(1).max(100),
    breedId: z.number().int().optional(),
    gender: z.enum(["MALE", "FEMALE", "UNKNOWN"]).optional(),
    ageMonths: z.number().int().min(0).max(360).optional(),
  })).min(1).max(10),
});

export const checkInSchema = z.object({
  identifier: z.string().min(6).max(50), // QR token or booking ref
  locationId: z.number().int(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().min(3).max(500),
});

// ============================================================================
// Vaccination Schemas
// ============================================================================

export const recordVaccinationSchema = z.object({
  campaignPetId: z.number().int(),
  vaccineTypeId: z.number().int(),
  batchNumber: z.string().min(1).max(50),
  lotNumber: z.string().max(50).optional(),
  expiryDate: dateSchema.optional(),
  notes: z.string().max(500).optional(),
});

export const deferVaccinationSchema = z.object({
  campaignPetId: z.number().int(),
  reason: z.string().min(3).max(500),
});

// ============================================================================
// Staff Schemas
// ============================================================================

export const assignStaffSchema = z.object({
  campaignId: z.number().int(),
  userId: z.number().int(),
  role: z.enum(["ADMIN", "COORDINATOR", "CHECK_IN", "VACCINATOR", "SUPPORT"]),
  locationId: z.number().int().optional(),
});

export const updateStaffRoleSchema = z.object({
  role: z.enum(["ADMIN", "COORDINATOR", "CHECK_IN", "VACCINATOR", "SUPPORT"]),
});

// ============================================================================
// OTP Schemas
// ============================================================================

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["BOOKING", "VIEW_BOOKING"]).optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().length(6).regex(/^\d+$/, "OTP must be 6 digits"),
  purpose: z.enum(["BOOKING", "VIEW_BOOKING"]).optional(),
});

// ============================================================================
// Query Schemas
// ============================================================================

export const listCampaignsQuerySchema = paginationSchema.extend({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE", "UNLISTED"]).optional(),
  organizerId: z.coerce.number().int().optional(),
});

export const availableSlotsQuerySchema = z.object({
  locationId: z.coerce.number().int(),
  startDate: dateSchema,
  endDate: dateSchema,
});

export const bookingSearchQuerySchema = z.object({
  phone: phoneSchema.optional(),
  campaignId: z.coerce.number().int().optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED"]).optional(),
}).merge(paginationSchema);

export const listCampaignBookingsQuerySchema = paginationSchema.extend({
  status: z.string().max(32).optional(),
  cityCorporation: z.string().max(10).optional(),
  city: z.string().max(10).optional(),
  area: z.string().max(200).optional(),
  coverageZone: z.string().max(200).optional(),
  bookingMode: z.enum(["VENUE", "ZONE_INTEREST"]).optional(),
  dateFrom: z.string().max(32).optional(),
  dateTo: z.string().max(32).optional(),
  date: z.string().max(32).optional(),
  ownerName: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  reference: z.string().max(20).optional(),
  paymentStatus: z.string().max(32).optional(),
  petCountMin: z.coerce.number().int().min(0).optional(),
  petCountMax: z.coerce.number().int().min(0).optional(),
  locationId: z.coerce.number().int().optional(),
});

export const petCountSchema = z.coerce
  .number()
  .int()
  .min(1, "At least one pet must be selected.")
  .max(10);

export const paymentWebhookSchema = z.object({
  provider: z.string().max(64).optional(),
  transactionId: z.string().min(1).max(128),
  status: z.enum(["SUCCESS", "FAILED", "CANCELLED"]),
  amount: z.coerce.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Express checkout (3-step flow)
// ============================================================================

export const checkoutInitSchema = z
  .object({
    campaignSlug: z.string().min(1).max(100).optional(),
    campaignId: z.number().int().optional(),
    phone: phoneSchema,
    alternatePhone: phoneSchema.optional(),
    locationId: z.number().int().optional(),
    campaignLocationId: z.number().int().optional(),
    coverageZoneId: z.number().int().optional(),
    cityCorporationCode: z.enum(["DNCC", "DSCC"]).optional(),
    bdAreaId: z.number().int().optional(),
    bookingArea: z.string().trim().max(200).optional(),
    slotId: z.number().int().optional(),
    area: z
      .object({
        divisionId: z.number().int(),
        districtId: z.number().int(),
        upazilaId: z.number().int().optional(),
        division: z.string().max(100).optional(),
        district: z.string().max(100).optional(),
        upazila: z.string().max(100).optional(),
      })
      .optional(),
    fullAddress: z.string().trim().max(500).optional(),
    catCount: petCountSchema,
    couponCode: z.string().max(32).optional(),
    paymentMethod: z.enum(["BKASH", "NAGAD", "CARD", "SSLCOMMERZ"]).optional(),
    returnUrl: z.string().min(1).optional(),
    cancelUrl: z.string().min(1).optional(),
    resumeCheckoutId: z.string().min(10).max(40).optional(),
  })
  .superRefine((data, ctx) => {
    const locId = data.locationId ?? data.campaignLocationId;
    const zoneId = data.coverageZoneId;
    const dhakaCorp = data.cityCorporationCode;
    if (!locId && !data.area && !zoneId && !dhakaCorp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select city corporation and area, or a campaign location",
        path: ["cityCorporationCode"],
      });
    }
    if (dhakaCorp && !locId && !data.area && !zoneId) {
      if (!data.bdAreaId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select an area",
          path: ["bdAreaId"],
        });
      }
      return;
    }
    if (zoneId && !locId && !data.area) {
      if (!data.bdAreaId && (!data.bookingArea || data.bookingArea.trim().length < 2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select an area or enter a booking area label",
          path: ["bdAreaId"],
        });
      }
      return;
    }
    if (!locId && data.area) {
      if (!data.fullAddress || data.fullAddress.trim().length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter your full address (at least 10 characters)",
          path: ["fullAddress"],
        });
      }
    }
  });

export const assignVenueToBookingSchema = z.object({
  locationId: z.number().int(),
  slotId: z.number().int(),
  bookingDate: z.string().optional(),
});

export const checkoutConfirmFreeSchema = z.object({
  checkoutId: z.string().min(10).max(40),
});

export const claimBookingSchema = z.object({
  phone: phoneSchema,
  bookingRef: z.string().min(6).max(20),
  verificationCode: z.string().min(4).max(12),
});

// ============================================================================
// Included vaccines (branded display)
// ============================================================================

const coveredDiseasesSchema = z
  .array(z.string().min(1).max(200))
  .max(30)
  .default([]);

export const createIncludedVaccineSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  coveredDiseases: coveredDiseasesSchema,
  displayOrder: z.number().int().min(0).max(999).optional(),
});

export const updateIncludedVaccineSchema = createIncludedVaccineSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const reorderIncludedVaccinesSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1),
});
