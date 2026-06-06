/**
 * Campaign Module Type Definitions
 * 2026 Cat Flu + Rabies Vaccination Campaign
 */

import type {
  CampaignStatus,
  CampaignVisibility,
  CampaignPricingType,
  CampaignSlotStatus,
  CampaignBookingStatus,
  CampaignPaymentStatus,
  CampaignRefundStatus,
  CampaignPetVaccinationStatus,
  CampaignStaffRole,
  CampaignSmsStatus,
  Gender,
} from "@prisma/client";

// ============================================================================
// Campaign Types
// ============================================================================

export interface CreateCampaignInput {
  name: string;
  slug: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  bookingStartAt?: Date;
  bookingEndAt?: Date;
  countdownEnabled?: boolean;
  status?: CampaignStatus;
  pricingType?: CampaignPricingType;
  priceAmount?: number;
  vaccineCost?: number;
  serviceCharge?: number;
  packageFeatures?: string[];
  maxPetsPerBooking?: number;
  advanceBookingDays?: number;
  minAdvanceHours?: number;
  allowWalkIns?: boolean;
  walkInQuotaPercent?: number;
  targetVaccinations?: number;
  organizerId?: number;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  bookingStartAt?: Date | null;
  bookingEndAt?: Date | null;
  countdownEnabled?: boolean;
  status?: CampaignStatus;
  visibility?: CampaignVisibility;
  pricingType?: CampaignPricingType;
  priceAmount?: number;
  vaccineCost?: number;
  serviceCharge?: number;
  packageFeatures?: string[];
  maxPetsPerBooking?: number;
  advanceBookingDays?: number;
  minAdvanceHours?: number;
  allowWalkIns?: boolean;
  walkInQuotaPercent?: number;
  targetVaccinations?: number;
}

// ============================================================================
// Location Types
// ============================================================================

export interface CreateLocationInput {
  campaignId: number;
  name: string;
  address?: string;
  addressJson?: CampaignLocationAddressJson;
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
  dailyCapacity?: number;
}

export type CampaignLocationAddressJson = {
  division?: string;
  district?: string;
  upazila?: string;
  area?: string;
  bookingArea?: string;
  coverageZoneId?: number;
  bdAreaId?: number;
  bdAreaCode?: string;
};

export interface UpdateLocationInput {
  name?: string;
  address?: string;
  addressJson?: CampaignLocationAddressJson;
  latitude?: number;
  longitude?: number;
  contactName?: string;
  contactPhone?: string;
  dailyCapacity?: number;
  isActive?: boolean;
}

// ============================================================================
// Slot Types
// ============================================================================

export type SlotRepeatPattern = "DAILY" | "WEEKDAYS" | "WEEKENDS" | "CUSTOM";

export interface SlotSessionFields {
  sessionName?: string;
  checkInStartTime?: string;
  bookingCutoffTime?: string;
}

export interface CreateSlotInput extends SlotSessionFields {
  locationId: number;
  date: Date;
  startTime: string; // "09:00"
  endTime: string;   // "12:00"
  capacity?: number;
}

export interface BulkCreateSlotsInput extends SlotSessionFields {
  locationId: number;
  startDate: Date;
  endDate: Date;
  slots: Array<{
    startTime: string;
    endTime: string;
    capacity?: number;
    sessionName?: string;
    checkInStartTime?: string;
    bookingCutoffTime?: string;
  }>;
  /** @deprecated Prefer repeatPattern */
  excludeWeekends?: boolean;
  repeatPattern?: SlotRepeatPattern;
  customDays?: number[];
}

export interface SlotAvailability {
  /** CampaignSlot primary key (same value as slotId). */
  id: number;
  slotId: number;
  date: string;
  sessionName: string;
  startTime: string;
  endTime: string;
  startTimeLabel: string;
  endTimeLabel: string;
  checkInStartTime: string | null;
  bookingCutoffTime: string | null;
  capacity: number;
  bookedCount: number;
  walkInCount: number;
  availableCount: number;
  remainingCapacity: number;
  status: CampaignSlotStatus;
}

// ============================================================================
// Booking Types
// ============================================================================

export interface CreateBookingInput {
  campaignId: number;
  locationId: number;
  slotId: number;
  owner: {
    phone: string;
    name: string;
    address?: {
      division?: string;
      district?: string;
      area?: string;
    };
  };
  pets: Array<{
    name: string;
    animalTypeId?: number;
    breedId?: number;
    gender?: Gender;
    ageMonths?: number;
    colorDescription?: string;
  }>;
}

export interface WalkInRegistrationInput {
  campaignId: number;
  locationId: number;
  owner: {
    phone: string;
    name: string;
  };
  pets: Array<{
    name: string;
    breedId?: number;
    gender?: Gender;
    ageMonths?: number;
  }>;
}

export interface BookingDetails {
  id: number;
  bookingRef: string;
  qrToken: string;
  verificationCode?: string;
  status: CampaignBookingStatus;
  bookingDate: Date;
  petCount?: number;
  bookingMode?: "VENUE" | "ZONE_INTEREST";
  coverageZoneId?: number | null;
  coverageZoneName?: string | null;
  bdAreaId?: number | null;
  bookingArea?: string | null;
  pendingAssignment?: boolean;
  cityCorporation?: string | null;
  area?: string | null;
  locationLabel?: string | null;
  slot?: {
    startTime: string;
    endTime: string;
    sessionName?: string;
    startTimeLabel?: string;
    endTimeLabel?: string;
  } | null;
  location?: {
    id?: number;
    name?: string;
    address?: string;
    cityCorporation?: string;
    area?: string;
    locationLabel?: string;
  } | null;
  owner: {
    phone: string;
    name: string;
  };
  pets: Array<{
    id: number;
    name: string;
    vaccinationStatus: CampaignPetVaccinationStatus;
    certificateToken?: string;
    ticketToken?: string;
    ticketUrl?: string;
  }>;
  paymentStatus: CampaignPaymentStatus;
  queueNumber?: string;
  checkedInAt?: Date;
  completedAt?: Date;
}

// ============================================================================
// Check-in Types
// ============================================================================

export interface CheckInResult {
  success: boolean;
  booking?: BookingDetails;
  queueNumber?: string;
  position?: number;
  estimatedWait?: number;
  error?: string;
}

export interface QueueStatus {
  currentServing?: string;
  waitingCount: number;
  estimatedWaitMinutes: number;
  queue: Array<{
    queueNumber: string;
    ownerName: string;
    petCount: number;
    status: CampaignBookingStatus;
    waitingMinutes: number;
  }>;
}

// ============================================================================
// Vaccination Types
// ============================================================================

export interface RecordVaccinationInput {
  campaignPetId: number;
  vaccineTypeId: number;
  batchNumber: string;
  lotNumber?: string;
  expiryDate?: Date;
  notes?: string;
  administeredByUserId: number;
}

export interface VaccinationResult {
  success: boolean;
  vaccinationId?: number;
  certificateToken?: string;
  error?: string;
}

// ============================================================================
// Staff Types
// ============================================================================

export interface AssignStaffInput {
  campaignId: number;
  userId: number;
  role: CampaignStaffRole;
  locationId?: number;
}

export interface StaffPermissions {
  canCheckIn: boolean;
  canRegisterWalkIn: boolean;
  canRecordVaccination: boolean;
  canManageQueue: boolean;
  canViewReports: boolean;
  canExportData: boolean;
  canManageStaff: boolean;
  canManageCampaign: boolean;
}

// ============================================================================
// SMS Types
// ============================================================================

export type SmsTemplateCode =
  | "OTP"
  | "BOOKING_REQUEST"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_ZONE_INTEREST"
  | "VENUE_ASSIGNED"
  | "SLOT_CONFIRMED"
  | "REMINDER_24H"
  | "REMINDER_2H"
  | "VACCINATION_COMPLETE"
  | "CERTIFICATE_READY"
  | "BOOKING_CANCELLED"
  | "NO_SHOW"
  | "ANNOUNCEMENT";

export interface SendSmsInput {
  phone: string;
  templateCode: SmsTemplateCode;
  campaignId: number;
  bookingId?: number;
  variables: Record<string, string>;
}

// ============================================================================
// Report Types
// ============================================================================

export interface DailySummary {
  date: string;
  bookings: {
    total: number;
    new: number;
    cancelled: number;
    walkIns: number;
  };
  attendance: {
    scheduled: number;
    checkedIn: number;
    completed: number;
    noShow: number;
    showRate: number;
  };
  vaccinations: {
    total: number;
    byType: Array<{ vaccineTypeId: number; name: string; count: number }>;
  };
  queue: {
    avgWaitMinutes: number;
    maxWaitMinutes: number;
  };
}

export interface CampaignStats {
  totalBookings: number;
  totalVaccinations: number;
  completionRate: number;
  showRate: number;
  byLocation: Array<{
    locationId: number;
    locationName: string;
    bookings: number;
    vaccinations: number;
  }>;
  byDay: Array<{
    date: string;
    bookings: number;
    vaccinations: number;
  }>;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditLogInput {
  campaignId: number;
  actorUserId?: number;
  actorRole?: string;
  actorIp?: string;
  action: string;
  entityType: string;
  entityId?: number;
  beforeJson?: Record<string, unknown>;
  afterJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// Campaign Config Types
// ============================================================================

export interface CampaignConfigInput {
  bookingEnabled?: boolean;
  onlinePaymentEnabled?: boolean;
  payAtVenueEnabled?: boolean;
  walkInAllowed?: boolean;
  approvalRequired?: boolean;
  slotRequired?: boolean;
  autoCloseWhenFull?: boolean;
  maxCapacity?: number;
  maxCatsPerBooking?: number;
  showRemainingSlots?: boolean;
  lateBookingAllowed?: boolean;
}

export interface CampaignAnalytics {
  bookingsByLocation: Array<{
    locationId: number;
    locationName: string;
    address: string | null;
    dailyCapacity: number;
    totalBookings: number;
    totalCats: number;
  }>;
  bookingsByCoverageZone: Array<{
    regionId: number;
    division: string | null;
    district: string | null;
    city: string | null;
    targetCapacity: number;
    bookedCount: number;
    totalBookings: number;
    totalCats: number;
    isActive: boolean;
  }>;
  paymentAnalytics: {
    onlinePayments: number;
    onlineRevenue: number;
    venuePayments: number;
    venueRevenue: number;
    pendingPayments: number;
    expectedRevenue: number;
    collectedRevenue: number;
    totalBookings: number;
  };
  topLocations: Array<{
    rank: number;
    locationId: number;
    locationName: string;
    address: string | null;
    totalBookings: number;
    totalCats: number;
    totalVaccinations: number;
  }>;
  generatedAt: string;
}
