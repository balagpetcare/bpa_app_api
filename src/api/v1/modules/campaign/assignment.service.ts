/**
 * Campaign slot/location auto-assignment for simplified booking flow.
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { AreaErrors, LocationErrors, SlotErrors } from "./campaign.errors";
import { addDays, diffInHours, isInPast, startOfDay } from "./campaign.utils";

export type AssignmentResult = {
  rolloutRegionId: number | null;
  locationId: number;
  slotId: number;
  locationName: string;
  slotDate: Date;
  startTime: string;
  endTime: string;
};

export async function resolveRolloutRegion(input: {
  campaignId: number;
  divisionId: number;
  districtId: number;
  upazilaId?: number;
}) {
  const regions = await prisma.campaignRolloutRegion.findMany({
    where: {
      campaignId: input.campaignId,
      isActive: true,
      divisionId: input.divisionId,
      OR: [{ districtId: input.districtId }, { districtId: null }],
    },
    orderBy: [{ districtId: "desc" }, { upazilaId: "desc" }],
  });

  if (regions.length === 0) {
    throw AreaErrors.NOT_OPEN();
  }

  if (input.upazilaId) {
    const exact = regions.find(
      (r) => r.upazilaId === input.upazilaId || r.upazilaId === null
    );
    if (exact) return exact;
  }

  return regions[0];
}

export async function resolveLocationForRegion(
  campaignId: number,
  region: { id: number; locationId: number | null; districtId: number | null }
): Promise<{ id: number; name: string }> {
  if (region.locationId) {
    const loc = await prisma.campaignLocation.findFirst({
      where: { id: region.locationId, campaignId, isActive: true },
      select: { id: true, name: true },
    });
    if (loc) return loc;
  }

  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId, isActive: true },
    select: { id: true, name: true, addressJson: true },
    orderBy: { id: "asc" },
  });

  if (locations.length === 0) {
    throw AreaErrors.NO_AVAILABILITY();
  }

  if (region.districtId) {
    const districtMatch = locations.find((loc) => {
      const json = loc.addressJson as { districtId?: number } | null;
      return json?.districtId === region.districtId;
    });
    if (districtMatch) return { id: districtMatch.id, name: districtMatch.name };
  }

  return { id: locations[0].id, name: locations[0].name };
}

export async function findNextAvailableSlot(input: {
  locationId: number;
  campaignId: number;
  minAdvanceHours: number;
  advanceBookingDays: number;
}): Promise<{ id: number; date: Date; startTime: string; endTime: string }> {
  const today = startOfDay(new Date());
  const maxDate = addDays(today, input.advanceBookingDays);

  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId: input.locationId,
      status: "OPEN",
      date: { gte: today, lte: maxDate },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const now = new Date();

  for (const slot of slots) {
    if (slot.bookedCount >= slot.capacity) continue;

    const slotDate = new Date(slot.date);
    if (isInPast(slotDate)) continue;

    const slotDateTime = new Date(slotDate);
    const [hours, minutes] = slot.startTime.split(":").map(Number);
    slotDateTime.setHours(hours, minutes, 0, 0);

    if (diffInHours(slotDateTime, now) < input.minAdvanceHours) continue;

    return {
      id: slot.id,
      date: slotDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
    };
  }

  throw SlotErrors.NOT_AVAILABLE();
}

/** Dry-run assignment used at checkout init and fulfillment. */
export async function resolveAssignment(input: {
  campaignId: number;
  divisionId: number;
  districtId: number;
  upazilaId?: number;
  minAdvanceHours: number;
  advanceBookingDays: number;
}): Promise<AssignmentResult> {
  const region = await resolveRolloutRegion(input);
  const location = await resolveLocationForRegion(input.campaignId, region);
  const slot = await findNextAvailableSlot({
    locationId: location.id,
    campaignId: input.campaignId,
    minAdvanceHours: input.minAdvanceHours,
    advanceBookingDays: input.advanceBookingDays,
  });

  return {
    rolloutRegionId: region.id,
    locationId: location.id,
    slotId: slot.id,
    locationName: location.name,
    slotDate: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

/** V2 booking — user-selected campaign location (optional fixed slot). */
export async function resolveAssignmentByLocation(input: {
  campaignId: number;
  locationId: number;
  slotId?: number;
  minAdvanceHours: number;
  advanceBookingDays: number;
}): Promise<AssignmentResult> {
  const location = await prisma.campaignLocation.findFirst({
    where: { id: input.locationId, campaignId: input.campaignId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) {
    throw LocationErrors.NOT_FOUND(input.locationId);
  }

  const region = await prisma.campaignRolloutRegion.findFirst({
    where: {
      campaignId: input.campaignId,
      isActive: true,
      locationId: input.locationId,
    },
    orderBy: { id: "asc" },
  });

  let slot: { id: number; date: Date; startTime: string; endTime: string };

  if (input.slotId) {
    const row = await prisma.campaignSlot.findFirst({
      where: {
        id: input.slotId,
        locationId: input.locationId,
        status: "OPEN",
      },
    });
    if (!row || row.bookedCount >= row.capacity) {
      throw SlotErrors.NOT_AVAILABLE();
    }
    const slotDate = new Date(row.date);
    if (isInPast(slotDate)) {
      throw SlotErrors.NOT_AVAILABLE();
    }
    const slotDateTime = new Date(slotDate);
    const [hours, minutes] = row.startTime.split(":").map(Number);
    slotDateTime.setHours(hours, minutes, 0, 0);
    if (diffInHours(slotDateTime, new Date()) < input.minAdvanceHours) {
      throw SlotErrors.NOT_AVAILABLE();
    }
    slot = {
      id: row.id,
      date: slotDate,
      startTime: row.startTime,
      endTime: row.endTime,
    };
  } else {
    slot = await findNextAvailableSlot({
      locationId: input.locationId,
      campaignId: input.campaignId,
      minAdvanceHours: input.minAdvanceHours,
      advanceBookingDays: input.advanceBookingDays,
    });
  }

  return {
    rolloutRegionId: region?.id ?? null,
    locationId: location.id,
    slotId: slot.id,
    locationName: location.name,
    slotDate: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

export default {
  resolveRolloutRegion,
  resolveLocationForRegion,
  findNextAvailableSlot,
  resolveAssignment,
  resolveAssignmentByLocation,
};
