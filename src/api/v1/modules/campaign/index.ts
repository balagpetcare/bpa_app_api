/**
 * Campaign Module Index
 * 2026 Cat Flu + Rabies Vaccination Campaign
 * 
 * This module provides:
 * - Campaign management (create, update, publish)
 * - Location management
 * - Slot/schedule management
 * - Booking system with OTP authentication
 * - Check-in and queue management
 * - Vaccination recording
 * - Staff assignments and permissions
 * - SMS notifications
 * - Certificate generation
 * - Reporting and statistics
 */

// Types
export * from "./campaign.types";
export * from "./campaign.errors";

// Utilities
export * from "./campaign.utils";

// Services
export { default as campaignService } from "./campaign.service";
export { default as locationService } from "./location.service";
export { default as slotService } from "./slot.service";
export { default as bookingService } from "./booking.service";
export { default as vaccinationService } from "./vaccination.service";
export { default as staffService } from "./staff.service";
export { default as otpService } from "./otp.service";
export { default as paymentService } from "./payment.service";
export { default as qrService } from "./qr.service";
export { default as smsService } from "./sms.service";
export { default as certificateService } from "./certificate.service";
export { default as verificationService } from "./verification.service";

// Re-export commonly used functions
export {
  createCampaign,
  getCampaignById,
  getCampaignBySlug,
  getPublicCampaigns,
  updateCampaign,
  activateCampaign,
  getCampaignStats,
  getDailySummary,
  validateCampaignForBooking,
  logCampaignAudit,
} from "./campaign.service";

export {
  createLocation,
  getLocationById,
  listLocations,
  updateLocation,
  getLocationsWithAvailability,
  getTodayQueue,
} from "./location.service";

export {
  createSlot,
  bulkCreateSlots,
  getAvailableSlots,
  getCampaignSlots,
  hasCapacity,
} from "./slot.service";

export {
  createBooking,
  registerWalkIn,
  getBookingByRef,
  getBookingByQrToken,
  getBookingsByPhone,
  checkInBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
} from "./booking.service";

export {
  recordVaccination,
  deferVaccination,
  skipVaccination,
  getVaccinationByPetId,
  getVaccinationStats,
} from "./vaccination.service";

export {
  assignStaff,
  updateStaffRole,
  removeStaff,
  getStaffAssignment,
  listCampaignStaff,
  hasPermission,
  requirePermission,
  validateLocationAccess,
} from "./staff.service";

export {
  requestOtp,
  verifyOtp,
  verifySession,
  revokeSession,
} from "./otp.service";

export {
  createPaymentIntent,
  processPaymentWebhook,
  processRefund,
  getPaymentStatus,
} from "./payment.service";

export {
  generateBookingQr,
  generateCertificateQr,
  validateBookingQr,
  validateCertificateQr,
} from "./qr.service";

export {
  sendCampaignSms,
  sendBookingConfirmation,
  sendVaccinationComplete,
  scheduleReminders,
} from "./sms.service";

export {
  generateCertificate,
  getCertificateData,
  generateCertificatePdf,
  getBookingCertificates,
} from "./certificate.service";

export {
  verifyCertificate,
  verifyByShortCode,
  handleVerificationRequest,
} from "./verification.service";
