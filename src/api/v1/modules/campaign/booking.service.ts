/**
 * Campaign Booking Service
 * Handles booking creation, check-in, and management
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignBookingStatus, Prisma } from "@prisma/client";
import {
  CreateBookingInput,
  WalkInRegistrationInput,
  BookingDetails,
  CheckInResult,
} from "./campaign.types";
import {
  BookingErrors,
  SlotErrors,
  CampaignErrors,
  ValidationErrors,
} from "./campaign.errors";
import {
  generateBookingRef,
  generateQrToken,
  generateQueueNumber,
  getQueuePrefix,
  isValidBdPhone,
  normalizePhone,
  startOfDay,
  addHours,
  isToday,
  isInPast,
  diffInHours,
  formatDate,
} from "./campaign.utils";
import { validateCampaignForBooking, logCampaignAudit } from "./campaign.service";
import { sendBookingConfirmation } from "./sms.service";
import {
  formatCampaignTimeLabel,
  isPastBookingCutoff,
  resolveSessionName,
} from "./slot.schedule";
import { generateVerificationCode } from "./qr.service";
import { getCampaignConfigOrNull, validateBookingAgainstConfig } from "./config.service";

// ============================================================================
// Booking Creation
// ============================================================================

/**
 * Create a new booking (transaction-safe with slot capacity check)
 */
export async function createBooking(
  input: CreateBookingInput,
  sessionPhone?: string
): Promise<BookingDetails> {
  // Validate phone
  if (!isValidBdPhone(input.owner.phone)) {
    throw ValidationErrors.INVALID_PHONE();
  }
  const ownerPhone = normalizePhone(input.owner.phone);

  // Verify session phone matches (if provided)
  if (sessionPhone && normalizePhone(sessionPhone) !== ownerPhone) {
    throw ValidationErrors.INVALID_INPUT("Phone number does not match session");
  }

  // Validate campaign
  const campaign = await validateCampaignForBooking(input.campaignId);

  // Validate against campaign config (if exists)
  const configRow = await getCampaignConfigOrNull(input.campaignId);
  if (configRow) {
    const isPaid = campaign.pricingType !== "FREE";
    const configCheck = validateBookingAgainstConfig(configRow, input.pets?.length ?? 0, false, isPaid);
    if (!configCheck.valid) {
      throw ValidationErrors.INVALID_INPUT(configCheck.errors[0]);
    }
  }

  // Validate pet count
  const maxPets = configRow?.maxCatsPerBooking ?? campaign.maxPetsPerBooking;
  if (!input.pets || input.pets.length === 0) {
    throw BookingErrors.NO_PETS();
  }
  if (input.pets.length > maxPets) {
    throw BookingErrors.TOO_MANY_PETS(maxPets);
  }

  // Transaction for atomic booking creation
  return prisma.$transaction(async (tx) => {
    // Lock and check slot capacity
    const slot = await tx.campaignSlot.findUnique({
      where: { id: input.slotId },
      include: {
        location: true,
      },
    });

    if (!slot) {
      throw SlotErrors.NOT_FOUND(input.slotId);
    }

    if (slot.location.campaignId !== input.campaignId) {
      throw ValidationErrors.INVALID_INPUT("Slot does not belong to this campaign");
    }

    if (slot.status === "CLOSED" || slot.status === "CANCELLED") {
      throw SlotErrors.CLOSED();
    }

    if (slot.bookedCount >= slot.capacity) {
      throw SlotErrors.FULL();
    }

    // Check slot date
    const slotDate = new Date(slot.date);
    if (isInPast(slotDate)) {
      throw SlotErrors.IN_PAST();
    }

    // Check minimum advance booking time
    const slotDateTime = new Date(slotDate);
    const [hours, minutes] = slot.startTime.split(":").map(Number);
    slotDateTime.setHours(hours, minutes, 0, 0);

    const hoursUntilSlot = diffInHours(slotDateTime, new Date());
    if (hoursUntilSlot < campaign.minAdvanceHours) {
      throw SlotErrors.TOO_SOON(campaign.minAdvanceHours);
    }

    if (isPastBookingCutoff(slotDate, slot.startTime, slot.endTime, slot.bookingCutoffTime)) {
      throw SlotErrors.BOOKING_CUTOFF_PASSED();
    }

    // Check for existing booking on same date for this phone
    const existingBooking = await tx.campaignBooking.findFirst({
      where: {
        campaignId: input.campaignId,
        ownerPhone,
        bookingDate: slotDate,
        status: { notIn: ["CANCELLED"] },
      },
    });

    if (existingBooking) {
      throw BookingErrors.ALREADY_EXISTS(ownerPhone, formatDate(slotDate));
    }

    // Check if owner has BPA account
    const existingUser = await tx.userAuth.findFirst({
      where: { phone: ownerPhone },
      include: { user: true },
    });

    // Generate unique tokens
    let bookingRef: string;
    let attempts = 0;
    do {
      bookingRef = generateBookingRef();
      const exists = await tx.campaignBooking.findUnique({
        where: { bookingRef },
      });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new Error("Failed to generate unique booking reference");
    }

    const qrToken = generateQrToken();

    // Create booking
    const booking = await tx.campaignBooking.create({
      data: {
        bookingRef,
        qrToken,
        campaignId: input.campaignId,
        locationId: input.locationId,
        slotId: input.slotId,
        ownerUserId: existingUser?.user.id,
        ownerPhone,
        ownerName: input.owner.name.trim(),
        ownerAddressJson: input.owner.address as Prisma.InputJsonValue,
        bookingDate: slotDate,
        petCount: input.pets.length,
        status: campaign.pricingType === "FREE" ? "CONFIRMED" : "DRAFT",
        paymentStatus: campaign.pricingType === "FREE" ? "NOT_REQUIRED" : "PENDING",
        linkSource: existingUser ? "EXISTING_USER" : null,
        linkedAt: existingUser ? new Date() : null,
      },
    });

    // Create pets
    const pets = await Promise.all(
      input.pets.map((pet) =>
        tx.campaignPet.create({
          data: {
            bookingId: booking.id,
            name: pet.name.trim(),
            animalTypeId: pet.animalTypeId ?? 2, // Default to Cat
            breedId: pet.breedId,
            gender: pet.gender,
            ageMonths: pet.ageMonths,
            colorDescription: pet.colorDescription,
          },
        })
      )
    );

    // Increment slot booked count
    await tx.campaignSlot.update({
      where: { id: input.slotId },
      data: {
        bookedCount: { increment: 1 },
        status: slot.bookedCount + 1 >= slot.capacity ? "FULL" : "OPEN",
      },
    });

    // Audit log
    await tx.campaignAuditLog.create({
      data: {
        campaignId: input.campaignId,
        action: "BOOKING_CREATED",
        entityType: "CampaignBooking",
        entityId: booking.id,
        afterJson: {
          bookingRef,
          ownerPhone,
          petCount: input.pets.length,
          slotId: input.slotId,
        } as Prisma.InputJsonValue,
      },
    });

    const details = mapToBookingDetails(booking, slot, slot.location, pets);

    if (campaign.pricingType === "FREE") {
      sendBookingConfirmation(booking.id).catch((err) =>
        console.warn("[Campaign] booking confirmation SMS failed:", err?.message)
      );
    }

    return details;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 10000,
  });
}

/**
 * Register a walk-in (same-day, no advance booking)
 */
export async function registerWalkIn(
  input: WalkInRegistrationInput,
  staffUserId: number
): Promise<BookingDetails> {
  // Validate phone
  if (!isValidBdPhone(input.owner.phone)) {
    throw ValidationErrors.INVALID_PHONE();
  }
  const ownerPhone = normalizePhone(input.owner.phone);

  // Validate campaign
  const campaign = await validateCampaignForBooking(input.campaignId);

  if (!campaign.allowWalkIns) {
    throw BookingErrors.WALK_IN_NOT_ALLOWED();
  }

  // Get today's date
  const today = startOfDay(new Date());

  // Find available slot for today at this location
  const availableSlot = await prisma.campaignSlot.findFirst({
    where: {
      locationId: input.locationId,
      date: today,
      status: "OPEN",
    },
    include: {
      location: true,
    },
    orderBy: { startTime: "asc" },
  });

  if (!availableSlot) {
    throw SlotErrors.NOT_AVAILABLE();
  }

  // Check walk-in quota
  const walkInToday = await prisma.campaignBooking.count({
    where: {
      locationId: input.locationId,
      bookingDate: today,
      isWalkIn: true,
      status: { notIn: ["CANCELLED"] },
    },
  });

  const maxWalkIns = Math.floor(
    (availableSlot.location.dailyCapacity * campaign.walkInQuotaPercent) / 100
  );

  if (walkInToday >= maxWalkIns) {
    throw BookingErrors.WALK_IN_QUOTA_EXCEEDED();
  }

  // Generate tokens
  const bookingRef = generateBookingRef();
  const qrToken = generateQrToken();

  // Create walk-in booking (already checked in)
  const booking = await prisma.$transaction(async (tx) => {
    // Get current queue position
    const queueCount = await tx.campaignBooking.count({
      where: {
        locationId: input.locationId,
        bookingDate: today,
        checkedInAt: { not: null },
      },
    });

    const queueNumber = generateQueueNumber(
      "W", // W for walk-in
      queueCount + 1
    );

    const booking = await tx.campaignBooking.create({
      data: {
        bookingRef,
        qrToken,
        campaignId: input.campaignId,
        locationId: input.locationId,
        slotId: availableSlot.id,
        ownerPhone,
        ownerName: input.owner.name.trim(),
        bookingDate: today,
        petCount: input.pets.length,
        status: "CHECKED_IN",
        isWalkIn: true,
        checkedInAt: new Date(),
        checkedInByUserId: staffUserId,
        queueNumber,
        paymentStatus: campaign.pricingType === "FREE" ? "NOT_REQUIRED" : "PENDING",
      },
    });

    // Create pets
    const pets = await Promise.all(
      input.pets.map((pet) =>
        tx.campaignPet.create({
          data: {
            bookingId: booking.id,
            name: pet.name.trim(),
            animalTypeId: 2, // Cat
            breedId: pet.breedId,
            gender: pet.gender,
            ageMonths: pet.ageMonths,
          },
        })
      )
    );

    // Update slot walk-in count
    await tx.campaignSlot.update({
      where: { id: availableSlot.id },
      data: { walkInCount: { increment: 1 } },
    });

    // Audit log
    await tx.campaignAuditLog.create({
      data: {
        campaignId: input.campaignId,
        actorUserId: staffUserId,
        action: "WALK_IN_REGISTERED",
        entityType: "CampaignBooking",
        entityId: booking.id,
        afterJson: {
          bookingRef,
          queueNumber,
          ownerPhone,
          petCount: input.pets.length,
        } as Prisma.InputJsonValue,
      },
    });

    return { booking, pets };
  });

  return mapToBookingDetails(
    booking.booking,
    availableSlot,
    availableSlot.location,
    booking.pets
  );
}

// ============================================================================
// Booking Lookup
// ============================================================================

/**
 * Get booking by reference
 */
export async function getBookingByRef(bookingRef: string): Promise<BookingDetails> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { bookingRef },
    include: {
      slot: true,
      location: true,
      pets: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!booking) {
    throw BookingErrors.NOT_FOUND(bookingRef);
  }

  return mapToBookingDetails(booking, booking.slot, booking.location, booking.pets);
}

/**
 * Get booking by QR token
 */
export async function getBookingByQrToken(qrToken: string): Promise<BookingDetails> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { qrToken },
    include: {
      slot: true,
      location: true,
      pets: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!booking) {
    throw BookingErrors.QR_INVALID();
  }

  return mapToBookingDetails(booking, booking.slot, booking.location, booking.pets);
}

/**
 * Get bookings by phone number
 */
export async function getBookingsByPhone(
  phone: string,
  campaignId?: number
): Promise<BookingDetails[]> {
  const normalizedPhone = normalizePhone(phone);

  const bookings = await prisma.campaignBooking.findMany({
    where: {
      ownerPhone: normalizedPhone,
      ...(campaignId && { campaignId }),
    },
    include: {
      slot: true,
      location: true,
      pets: {
        orderBy: { id: "asc" },
      },
    },
    orderBy: { bookingDate: "desc" },
  });

  return bookings.map((b) =>
    mapToBookingDetails(b, b.slot, b.location, b.pets)
  );
}

// ============================================================================
// Check-in
// ============================================================================

/**
 * Check in a booking by QR token or reference
 */
export async function checkInBooking(
  identifier: string,
  staffUserId: number,
  locationId: number
): Promise<CheckInResult> {
  // Find booking
  let booking = await prisma.campaignBooking.findFirst({
    where: {
      OR: [{ qrToken: identifier }, { bookingRef: identifier.toUpperCase() }],
    },
    include: {
      slot: true,
      location: true,
      pets: true,
    },
  });

  if (!booking) {
    return {
      success: false,
      error: "Booking not found",
    };
  }

  // Validate location
  if (booking.locationId !== locationId) {
    return {
      success: false,
      error: "Booking is for a different location",
    };
  }

  // Validate booking date
  if (!isToday(new Date(booking.bookingDate))) {
    return {
      success: false,
      error: "Booking is not for today",
    };
  }

  // Check status
  if (booking.status === "CHECKED_IN" || booking.status === "IN_PROGRESS") {
    return {
      success: false,
      error: "Already checked in",
    };
  }

  if (booking.status === "COMPLETED") {
    return {
      success: false,
      error: "Booking already completed",
    };
  }

  if (booking.status === "CANCELLED") {
    return {
      success: false,
      error: "Booking was cancelled",
    };
  }

  if (booking.status !== "CONFIRMED") {
    return {
      success: false,
      error: `Invalid booking status: ${booking.status}`,
    };
  }

  // Check payment if required
  if (booking.paymentStatus === "PENDING") {
    return {
      success: false,
      error: "Payment required before check-in",
    };
  }

  // Generate queue number
  const queueCount = await prisma.campaignBooking.count({
    where: {
      locationId,
      bookingDate: booking.bookingDate,
      checkedInAt: { not: null },
    },
  });

  const queueNumber = generateQueueNumber(
    getQueuePrefix(booking.slot.startTime),
    queueCount + 1
  );

  // Update booking
  const updated = await prisma.campaignBooking.update({
    where: { id: booking.id },
    data: {
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      checkedInByUserId: staffUserId,
      queueNumber,
    },
    include: {
      slot: true,
      location: true,
      pets: true,
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: booking.campaignId,
    actorUserId: staffUserId,
    action: "BOOKING_CHECKED_IN",
    entityType: "CampaignBooking",
    entityId: booking.id,
    afterJson: { queueNumber },
  });

  // Calculate wait position
  const waitingAhead = await prisma.campaignBooking.count({
    where: {
      locationId,
      bookingDate: booking.bookingDate,
      status: "CHECKED_IN",
      checkedInAt: { lt: updated.checkedInAt! },
    },
  });

  return {
    success: true,
    booking: mapToBookingDetails(updated, updated.slot, updated.location, updated.pets),
    queueNumber,
    position: waitingAhead + 1,
    estimatedWait: waitingAhead * 5, // 5 min per booking estimate
  };
}

// ============================================================================
// Booking Status Updates
// ============================================================================

/**
 * Mark booking as no-show
 */
export async function markNoShow(
  bookingId: number,
  staffUserId: number
): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw BookingErrors.NOT_FOUND();
  }

  if (booking.status !== "CONFIRMED") {
    throw BookingErrors.INVALID_STATUS(booking.status, "CONFIRMED");
  }

  await prisma.campaignBooking.update({
    where: { id: bookingId },
    data: { status: "NO_SHOW" },
  });

  // Decrement slot count
  await prisma.campaignSlot.update({
    where: { id: booking.slotId },
    data: {
      bookedCount: { decrement: 1 },
      status: "OPEN",
    },
  });

  await logCampaignAudit({
    campaignId: booking.campaignId,
    actorUserId: staffUserId,
    action: "BOOKING_NO_SHOW",
    entityType: "CampaignBooking",
    entityId: bookingId,
  });
}

/**
 * Cancel booking
 */
export async function cancelBooking(
  bookingId: number,
  reason: string,
  cancelledByUserId?: number
): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw BookingErrors.NOT_FOUND();
  }

  if (booking.status === "CANCELLED") {
    throw BookingErrors.ALREADY_CANCELLED();
  }

  if (booking.status === "COMPLETED") {
    throw BookingErrors.ALREADY_COMPLETED();
  }

  await prisma.$transaction(async (tx) => {
    await tx.campaignBooking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

    // Decrement slot count for active reservations (including unpaid DRAFT)
    if (["DRAFT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"].includes(booking.status)) {
      await tx.campaignSlot.update({
        where: { id: booking.slotId },
        data: {
          bookedCount: { decrement: 1 },
          status: "OPEN",
        },
      });

      if (booking.rolloutRegionId) {
        await tx.campaignRolloutRegion.update({
          where: { id: booking.rolloutRegionId },
          data: { bookedCount: { decrement: booking.petCount } },
        });
      }
    }

    await tx.campaignAuditLog.create({
      data: {
        campaignId: booking.campaignId,
        actorUserId: cancelledByUserId,
        action: "BOOKING_CANCELLED",
        entityType: "CampaignBooking",
        entityId: bookingId,
        afterJson: { reason } as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Complete booking (all pets vaccinated)
 */
export async function completeBooking(
  bookingId: number,
  staffUserId: number
): Promise<void> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: {
      pets: true,
    },
  });

  if (!booking) {
    throw BookingErrors.NOT_FOUND();
  }

  // Check all pets are vaccinated
  const allVaccinated = booking.pets.every(
    (p) => p.vaccinationStatus === "COMPLETED" || p.vaccinationStatus === "SKIPPED"
  );

  if (!allVaccinated) {
    throw ValidationErrors.INVALID_INPUT("Not all pets have been vaccinated");
  }

  await prisma.campaignBooking.update({
    where: { id: bookingId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  await logCampaignAudit({
    campaignId: booking.campaignId,
    actorUserId: staffUserId,
    action: "BOOKING_COMPLETED",
    entityType: "CampaignBooking",
    entityId: bookingId,
  });
}

// ============================================================================
// Helpers
// ============================================================================

function mapToBookingDetails(
  booking: any,
  slot: any,
  location: any,
  pets: any[]
): BookingDetails {
  return mapBookingRecordToDetails({ ...booking, slot, location, pets });
}

/** Map a Prisma booking row (with slot, location, pets includes) to API shape. */
export function mapBookingRecordToDetails(booking: {
  id: number;
  bookingRef: string;
  qrToken: string;
  status: string;
  bookingDate: Date;
  bookingMode?: string;
  coverageZoneId?: number | null;
  coverageZoneName?: string | null;
  bdAreaId?: number | null;
  bookingArea?: string | null;
  paymentStatus?: string;
  queueNumber?: string | null;
  checkedInAt?: Date | null;
  completedAt?: Date | null;
  petCount?: number;
  ownerPhone: string;
  ownerName: string;
  ownerAddressJson?: unknown;
  slot?: {
    startTime: string;
    endTime: string;
    sessionName?: string | null;
  } | null;
  location?: { id: number; name: string; address?: string | null } | null;
  pets: Array<{
    id: number;
    name: string;
    vaccinationStatus: string;
    certificateToken?: string | null;
  }>;
}): BookingDetails {
  const pendingAssignment =
    booking.bookingMode === "ZONE_INTEREST" && booking.status === "PENDING_ASSIGNMENT";

  return {
    id: booking.id,
    bookingRef: booking.bookingRef,
    qrToken: booking.qrToken,
    verificationCode: generateVerificationCode(booking.qrToken),
    status: booking.status as BookingDetails["status"],
    bookingDate: booking.bookingDate,
    bookingMode: (booking.bookingMode as BookingDetails["bookingMode"]) ?? "VENUE",
    coverageZoneId: booking.coverageZoneId ?? null,
    coverageZoneName: booking.coverageZoneName ?? null,
    bdAreaId: booking.bdAreaId ?? null,
    bookingArea: booking.bookingArea ?? null,
    pendingAssignment,
    slot: booking.slot
      ? {
          startTime: booking.slot.startTime,
          endTime: booking.slot.endTime,
          sessionName: resolveSessionName(booking.slot.sessionName, booking.slot.startTime),
          startTimeLabel: formatCampaignTimeLabel(booking.slot.startTime),
          endTimeLabel: formatCampaignTimeLabel(booking.slot.endTime),
        }
      : null,
    location: booking.location
      ? {
          id: booking.location.id,
          name: booking.location.name,
          address: booking.location.address ?? undefined,
        }
      : null,
    owner: {
      phone: booking.ownerPhone,
      name: booking.ownerName,
    },
    pets: booking.pets.map((p) => ({
      id: p.id,
      name: p.name,
      vaccinationStatus: p.vaccinationStatus as BookingDetails["pets"][0]["vaccinationStatus"],
      certificateToken: p.certificateToken,
    })),
    paymentStatus: booking.paymentStatus as BookingDetails["paymentStatus"],
    queueNumber: booking.queueNumber ?? undefined,
    checkedInAt: booking.checkedInAt ?? undefined,
    completedAt: booking.completedAt ?? undefined,
    petCount: booking.petCount,
  };
}

export default {
  createBooking,
  registerWalkIn,
  getBookingByRef,
  getBookingByQrToken,
  getBookingsByPhone,
  checkInBooking,
  markNoShow,
  cancelBooking,
  completeBooking,
};
