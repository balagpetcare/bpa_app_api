/**
 * Campaign Module Error Definitions
 * Standardized error handling for the vaccination campaign
 */

export class CampaignError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super(message);
    this.name = "CampaignError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ============================================================================
// Campaign Errors
// ============================================================================

export const CampaignErrors = {
  NOT_FOUND: (id: number) =>
    new CampaignError("CAMPAIGN_NOT_FOUND", `Campaign with ID ${id} not found`, 404),
  
  SLUG_EXISTS: (slug: string) =>
    new CampaignError("CAMPAIGN_SLUG_EXISTS", `Campaign with slug '${slug}' already exists`, 409),
  
  NOT_ACTIVE: () =>
    new CampaignError("CAMPAIGN_NOT_ACTIVE", "Campaign is not currently active", 400),
  
  ALREADY_ENDED: () =>
    new CampaignError("CAMPAIGN_ENDED", "Campaign has already ended", 400),
  
  NOT_STARTED: () =>
    new CampaignError("CAMPAIGN_NOT_STARTED", "Campaign has not started yet", 400),

  BOOKING_NOT_OPEN: () =>
    new CampaignError("BOOKING_NOT_OPEN", "Campaign booking is not open yet", 400),

  BOOKING_CLOSED: () =>
    new CampaignError("BOOKING_CLOSED", "Campaign booking has ended", 400),
  
  INVALID_DATE_RANGE: () =>
    new CampaignError("INVALID_DATE_RANGE", "End date must be after start date", 400),
};

// ============================================================================
// Location Errors
// ============================================================================

export const LocationErrors = {
  NOT_FOUND: (id: number) =>
    new CampaignError("LOCATION_NOT_FOUND", `Location with ID ${id} not found`, 404),
  
  NOT_ACTIVE: () =>
    new CampaignError("LOCATION_NOT_ACTIVE", "Location is not active", 400),
  
  HAS_BOOKINGS: () =>
    new CampaignError("LOCATION_HAS_BOOKINGS", "Cannot deactivate location with existing bookings", 400),

  DUPLICATE_NAME: (name: string) =>
    new CampaignError(
      "LOCATION_DUPLICATE_NAME",
      `A campaign location named "${name}" already exists`,
      409
    ),

  INVALID_AREA_MAPPING: () =>
    new CampaignError(
      "LOCATION_INVALID_AREA_MAPPING",
      "Selected BdArea is not mapped to the chosen coverage zone",
      400
    ),

  MISSING_COVERAGE_MAPPING: () =>
    new CampaignError(
      "LOCATION_MISSING_COVERAGE",
      "Select a coverage zone or a BdArea that maps to a zone",
      400
    ),
};

// ============================================================================
// Slot Errors
// ============================================================================

export const SlotErrors = {
  INVALID_ID: (id: unknown) =>
    new CampaignError(
      "INVALID_SLOT_ID",
      `Invalid slot ID: must be a positive integer (received ${String(id)})`,
      400,
      { slotId: id }
    ),

  NOT_FOUND: (id: number) =>
    new CampaignError("SLOT_NOT_FOUND", `Slot with ID ${id} not found`, 404),
  
  NOT_AVAILABLE: () =>
    new CampaignError("SLOT_NOT_AVAILABLE", "Selected slot is not available", 400),
  
  FULL: () =>
    new CampaignError("SLOT_FULL", "Selected slot has reached maximum capacity", 409),
  
  CLOSED: () =>
    new CampaignError("SLOT_CLOSED", "Selected slot is closed", 400),
  
  IN_PAST: () =>
    new CampaignError("SLOT_IN_PAST", "Cannot book a slot in the past", 400),
  
  TOO_SOON: (minHours: number) =>
    new CampaignError("SLOT_TOO_SOON", `Booking must be at least ${minHours} hours in advance`, 400),
  
  SCHEDULE_INVALID: (message: string) =>
    new CampaignError("SLOT_SCHEDULE_INVALID", message, 400),

  BOOKING_CUTOFF_PASSED: () =>
    new CampaignError("SLOT_BOOKING_CUTOFF_PASSED", "Online booking has closed for this session", 400),

  DUPLICATE: () =>
    new CampaignError("SLOT_DUPLICATE", "A slot with this time already exists for this location and date", 409),
  
  INVALID_TIME: () =>
    new CampaignError("INVALID_SLOT_TIME", "End time must be after start time", 400),
};

// ============================================================================
// Booking Errors
// ============================================================================

export const BookingErrors = {
  NOT_FOUND: (ref?: string) =>
    new CampaignError("BOOKING_NOT_FOUND", ref ? `Booking '${ref}' not found` : "Booking not found", 404),
  
  ALREADY_EXISTS: (phone: string, date: string) =>
    new CampaignError("BOOKING_EXISTS", `A booking already exists for ${phone} on ${date}`, 409),
  
  INVALID_STATUS: (current: string, required: string) =>
    new CampaignError("INVALID_BOOKING_STATUS", `Booking status is ${current}, expected ${required}`, 400),
  
  ALREADY_CHECKED_IN: () =>
    new CampaignError("ALREADY_CHECKED_IN", "Booking has already been checked in", 400),
  
  ALREADY_COMPLETED: () =>
    new CampaignError("ALREADY_COMPLETED", "Booking has already been completed", 400),
  
  ALREADY_CANCELLED: () =>
    new CampaignError("ALREADY_CANCELLED", "Booking has already been cancelled", 400),
  
  TOO_MANY_PETS: (max: number) =>
    new CampaignError("TOO_MANY_PETS", `Maximum ${max} pets allowed per booking`, 400),
  
  NO_PETS: () =>
    new CampaignError("NO_PETS", "At least one pet is required", 400),
  
  WRONG_DATE: () =>
    new CampaignError("WRONG_DATE", "Booking is not for today", 400),
  
  QR_INVALID: () =>
    new CampaignError("QR_INVALID", "Invalid or expired QR code", 400),
  
  WALK_IN_NOT_ALLOWED: () =>
    new CampaignError("WALK_IN_NOT_ALLOWED", "Walk-in registrations are not allowed for this campaign", 400),
  
  WALK_IN_QUOTA_EXCEEDED: () =>
    new CampaignError("WALK_IN_QUOTA_EXCEEDED", "Walk-in quota for today has been reached", 400),
};

// ============================================================================
// Pet Errors
// ============================================================================

export const PetErrors = {
  NOT_FOUND: (id: number) =>
    new CampaignError("PET_NOT_FOUND", `Campaign pet with ID ${id} not found`, 404),
  
  ALREADY_VACCINATED: () =>
    new CampaignError("ALREADY_VACCINATED", "Pet has already been vaccinated", 400),
  
  NOT_CHECKED_IN: () =>
    new CampaignError("PET_NOT_CHECKED_IN", "Booking must be checked in before vaccination", 400),
};

// ============================================================================
// Payment Errors
// ============================================================================

export const PaymentErrors = {
  REQUIRED: () =>
    new CampaignError("PAYMENT_REQUIRED", "Payment is required for this campaign", 402),
  
  ALREADY_PAID: () =>
    new CampaignError("ALREADY_PAID", "Payment has already been completed", 400),
  
  FAILED: (reason?: string) =>
    new CampaignError("PAYMENT_FAILED", reason || "Payment processing failed", 400),
  
  REFUND_FAILED: (reason?: string) =>
    new CampaignError("REFUND_FAILED", reason || "Refund processing failed", 400),
};

// ============================================================================
// Staff Errors
// ============================================================================

export const StaffErrors = {
  NOT_FOUND: () =>
    new CampaignError("STAFF_NOT_FOUND", "Staff member not found", 404),
  
  NOT_ASSIGNED: () =>
    new CampaignError("STAFF_NOT_ASSIGNED", "Staff is not assigned to this campaign", 403),
  
  NOT_AUTHORIZED: () =>
    new CampaignError("STAFF_NOT_AUTHORIZED", "Staff does not have permission for this action", 403),
  
  ALREADY_ASSIGNED: () =>
    new CampaignError("STAFF_ALREADY_ASSIGNED", "Staff is already assigned to this campaign/location", 409),
  
  WRONG_LOCATION: () =>
    new CampaignError("WRONG_LOCATION", "Staff is not assigned to this location", 403),
};

// ============================================================================
// OTP Errors
// ============================================================================

export const OtpErrors = {
  RATE_LIMITED: () =>
    new CampaignError("OTP_RATE_LIMITED", "Too many OTP requests. Please wait before trying again.", 429),
  
  EXPIRED: () =>
    new CampaignError("OTP_EXPIRED", "OTP has expired. Please request a new one.", 400),
  
  INVALID: () =>
    new CampaignError("OTP_INVALID", "Invalid OTP code", 400),
  
  MAX_ATTEMPTS: () =>
    new CampaignError("OTP_MAX_ATTEMPTS", "Maximum verification attempts exceeded", 400),
  
  SEND_FAILED: () =>
    new CampaignError("OTP_SEND_FAILED", "Failed to send OTP. Please try again.", 500),
};

// ============================================================================
// Certificate Errors
// ============================================================================

export const CertificateErrors = {
  NOT_FOUND: (token?: string) =>
    new CampaignError("CERTIFICATE_NOT_FOUND", token ? `Certificate '${token}' not found` : "Certificate not found", 404),
  
  NOT_GENERATED: () =>
    new CampaignError("CERTIFICATE_NOT_GENERATED", "Certificate has not been generated yet", 400),
  
  INVALID: () =>
    new CampaignError("CERTIFICATE_INVALID", "Certificate is invalid or has been revoked", 400),
  
  GENERATION_FAILED: () =>
    new CampaignError("CERTIFICATE_GENERATION_FAILED", "Failed to generate certificate", 500),
};

// ============================================================================
// Validation Errors
// ============================================================================

export const ValidationErrors = {
  INVALID_PHONE: () =>
    new CampaignError("INVALID_PHONE", "Invalid Bangladesh phone number format", 400),
  
  INVALID_DATE: (field: string) =>
    new CampaignError("INVALID_DATE", `Invalid date format for ${field}`, 400),
  
  REQUIRED_FIELD: (field: string) =>
    new CampaignError("REQUIRED_FIELD", `${field} is required`, 400),
  
  INVALID_INPUT: (message: string) =>
    new CampaignError("INVALID_INPUT", message, 400),
};

// ============================================================================
// Area / Checkout / Claim Errors
// ============================================================================

export const AreaErrors = {
  NOT_OPEN: () =>
    new CampaignError("AREA_NOT_OPEN", "Vaccination is not available in this area yet", 400),

  FULL: () =>
    new CampaignError("AREA_FULL", "This campaign area has reached capacity", 409),

  NO_AVAILABILITY: () =>
    new CampaignError("NO_AVAILABILITY", "No appointment slots available in this area", 409),
};

export const CheckoutErrors = {
  NOT_FOUND: () =>
    new CampaignError("CHECKOUT_NOT_FOUND", "Checkout session not found", 404),

  EXPIRED: () =>
    new CampaignError("CHECKOUT_EXPIRED", "Checkout session has expired", 410),

  ALREADY_FULFILLED: () =>
    new CampaignError("CHECKOUT_FULFILLED", "Booking already created for this checkout", 409),

  RATE_LIMIT: () =>
    new CampaignError("CHECKOUT_RATE_LIMIT", "Too many checkout attempts. Try again later.", 429),
};

export const ClaimErrors = {
  INVALID: () =>
    new CampaignError("CLAIM_INVALID", "Invalid credentials", 401),

  RATE_LIMIT: () =>
    new CampaignError("CLAIM_RATE_LIMIT", "Too many attempts. Try again later.", 429),
};
