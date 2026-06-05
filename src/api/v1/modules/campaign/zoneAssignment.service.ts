/**
 * Assign venue + slot to zone-interest bookings and notify via SMS.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import { BookingErrors, SlotErrors, LocationErrors, ValidationErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";
import { resolveAssignmentByLocation } from "./assignment.service";
import { sendVenueAssignmentSms } from "./sms.service";
import { mapBookingRecordToDetails } from "./booking.service";
import type { BookingDetails } from "./campaign.types";

export type AssignVenueInput = {
  locationId: number;
  slotId: number;
  bookingDate?: string;
};

export async function assignVenueToZoneBooking(
  bookingId: number,
  input: AssignVenueInput,
  assignedByUserId?: number
): Promise<BookingDetails> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    include: { campaign: true },
  });

  if (!booking) {
    throw BookingErrors.NOT_FOUND(String(bookingId));
  }
  if (booking.bookingMode !== "ZONE_INTEREST") {
    throw ValidationErrors.INVALID_INPUT("Booking is not a zone-interest registration");
  }
  if (booking.locationId != null && booking.status !== "PENDING_ASSIGNMENT") {
    throw ValidationErrors.INVALID_INPUT("Venue already assigned for this booking");
  }

  const location = await prisma.campaignLocation.findFirst({
    where: { id: input.locationId, campaignId: booking.campaignId, isActive: true },
    select: { id: true, name: true, address: true },
  });
  if (!location) {
    throw LocationErrors.NOT_FOUND(input.locationId);
  }

  const assignment = await resolveAssignmentByLocation({
    campaignId: booking.campaignId,
    locationId: input.locationId,
    slotId: input.slotId,
    minAdvanceHours: booking.campaign.minAdvanceHours,
    advanceBookingDays: booking.campaign.advanceBookingDays,
  });

  const bookingDate = input.bookingDate
    ? new Date(input.bookingDate)
    : assignment.slotDate;

  const result = await prisma.$transaction(async (tx) => {
    const slot = await tx.campaignSlot.findUnique({ where: { id: assignment.slotId } });
    if (!slot || slot.bookedCount >= slot.capacity) {
      throw SlotErrors.NOT_AVAILABLE();
    }

    const updated = await tx.campaignBooking.update({
      where: { id: bookingId },
      data: {
        locationId: assignment.locationId,
        slotId: assignment.slotId,
        bookingDate,
        status: "CONFIRMED",
        bookingMode: "VENUE",
        metadataJson: {
          ...((booking.metadataJson as object) ?? {}),
          zoneInterestAssignedAt: new Date().toISOString(),
          assignedByUserId: assignedByUserId ?? null,
        } as Prisma.InputJsonValue,
      },
      include: { slot: true, location: true, pets: true },
    });

    await tx.campaignSlot.update({
      where: { id: assignment.slotId },
      data: {
        bookedCount: { increment: 1 },
        status: slot.bookedCount + 1 >= slot.capacity ? "FULL" : "OPEN",
      },
    });

    return updated;
  });

  await logCampaignAudit({
    campaignId: booking.campaignId,
    action: "ZONE_BOOKING_VENUE_ASSIGNED",
    entityType: "CampaignBooking",
    entityId: bookingId,
    afterJson: {
      locationId: result.locationId,
      slotId: result.slotId,
      bookingDate: result.bookingDate,
    },
    actorUserId: assignedByUserId,
  });

  sendVenueAssignmentSms(bookingId).catch((err) =>
    console.error("[zoneAssignment] SMS failed", err)
  );

  return mapBookingRecordToDetails({
    ...result,
    slot: result.slot!,
    location: result.location!,
    pets: result.pets,
  });
}
