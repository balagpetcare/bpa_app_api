/**
 * Campaign Location Service
 * Manages vaccination locations/sites
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import {
  CreateLocationInput,
  UpdateLocationInput,
} from "./campaign.types";
import { LocationErrors, CampaignErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";
import { addDays, formatDate, startOfDay } from "./campaign.utils";
import { resolveCampaignId } from "./rollout.service";
import { parseLocationAddressJson, resolveCoverageBatch } from "./coverageLocation.service";
import {
  assertUniqueCampaignLocationName,
  mergeLocationAddressJson,
  normalizeLocationCoverageInput,
} from "./coverageAdmin.service";

// ============================================================================
// Location CRUD
// ============================================================================

/**
 * Create a new location for a campaign
 */
export async function createLocation(
  input: CreateLocationInput,
  createdByUserId?: number
) {
  // Verify campaign exists
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(input.campaignId);
  }

  await assertUniqueCampaignLocationName(input.campaignId, input.name);

  if (!input.addressJson) {
    throw LocationErrors.MISSING_COVERAGE_MAPPING();
  }

  let addressJson = input.addressJson;
  if (input.addressJson) {
    const meta = parseLocationAddressJson(input.addressJson);
    const coverage = await normalizeLocationCoverageInput({
      coverageZoneId: meta.coverageZoneId,
      bdAreaId: meta.bdAreaId,
      bookingArea: meta.bookingArea,
    });
    addressJson = mergeLocationAddressJson(input.addressJson, coverage);
  }

  const location = await prisma.campaignLocation.create({
    data: {
      campaignId: input.campaignId,
      name: input.name.trim(),
      address: input.address?.trim(),
      addressJson: addressJson as Prisma.InputJsonValue,
      latitude: input.latitude,
      longitude: input.longitude,
      contactName: input.contactName?.trim(),
      contactPhone: input.contactPhone,
      dailyCapacity: input.dailyCapacity ?? 100,
      isActive: true,
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: input.campaignId,
    actorUserId: createdByUserId,
    action: "LOCATION_CREATED",
    entityType: "CampaignLocation",
    entityId: location.id,
    afterJson: location as unknown as Record<string, unknown>,
  });

  return location;
}

/**
 * Get location by ID
 */
export async function getLocationById(id: number) {
  const location = await prisma.campaignLocation.findUnique({
    where: { id },
    include: {
      campaign: true,
      _count: {
        select: {
          slots: true,
          bookings: true,
          staff: true,
        },
      },
    },
  });

  if (!location) {
    throw LocationErrors.NOT_FOUND(id);
  }

  return location;
}

/**
 * List locations for a campaign
 */
export async function listLocations(
  campaignId: number,
  includeInactive: boolean = false
) {
  const locations = await prisma.campaignLocation.findMany({
    where: {
      campaignId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    include: {
      _count: {
        select: {
          slots: true,
          bookings: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const coverageByLocation = await resolveCoverageBatch(
    locations.map((l) => ({ id: l.id, addressJson: l.addressJson }))
  );

  return locations.map((loc) => {
    const meta = parseLocationAddressJson(loc.addressJson);
    const cov = coverageByLocation.get(loc.id);
    return {
      ...loc,
      coverageZoneId: meta.coverageZoneId ?? cov?.coverageZoneId ?? null,
      coverageZoneName: cov?.coverageZoneName ?? null,
      coverageZoneSlug: cov?.coverageZoneSlug ?? null,
      bookingArea: meta.bookingArea ?? cov?.bookingArea ?? null,
      bdAreaId: meta.bdAreaId ?? null,
    };
  });
}

/**
 * Update location
 */
export async function updateLocation(
  id: number,
  input: UpdateLocationInput,
  updatedByUserId?: number
) {
  const existing = await getLocationById(id);

  if (input.name) {
    await assertUniqueCampaignLocationName(existing.campaignId, input.name, id);
  }

  let addressJson = input.addressJson;
  if (input.addressJson !== undefined) {
    const meta = parseLocationAddressJson(input.addressJson);
    const coverage = await normalizeLocationCoverageInput({
      coverageZoneId: meta.coverageZoneId,
      bdAreaId: meta.bdAreaId,
      bookingArea: meta.bookingArea,
    });
    addressJson = mergeLocationAddressJson(
      input.addressJson ?? existing.addressJson,
      coverage
    );
  }

  // If deactivating, check for future bookings
  if (input.isActive === false) {
    const futureBookings = await prisma.campaignBooking.count({
      where: {
        locationId: id,
        bookingDate: { gte: new Date() },
        status: { in: ["CONFIRMED", "CHECKED_IN", "IN_PROGRESS"] },
      },
    });

    if (futureBookings > 0) {
      throw LocationErrors.HAS_BOOKINGS();
    }
  }

  const updated = await prisma.campaignLocation.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      address: input.address?.trim(),
      addressJson:
        addressJson !== undefined
          ? (addressJson as Prisma.InputJsonValue)
          : undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      contactName: input.contactName?.trim(),
      contactPhone: input.contactPhone,
      dailyCapacity: input.dailyCapacity,
      isActive: input.isActive,
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: existing.campaignId,
    actorUserId: updatedByUserId,
    action: "LOCATION_UPDATED",
    entityType: "CampaignLocation",
    entityId: id,
    beforeJson: existing as unknown as Record<string, unknown>,
    afterJson: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

/**
 * Deactivate location (soft delete)
 */
export async function deactivateLocation(id: number, userId?: number) {
  return updateLocation(id, { isActive: false }, userId);
}

// ============================================================================
// Location Stats
// ============================================================================

/**
 * Get location statistics
 */
export async function getLocationStats(locationId: number) {
  const location = await getLocationById(locationId);

  const [
    totalBookings,
    todayBookings,
    statusCounts,
    totalSlots,
    todaySlots,
  ] = await Promise.all([
    // Total bookings
    prisma.campaignBooking.count({
      where: { locationId },
    }),
    
    // Today's bookings
    prisma.campaignBooking.count({
      where: {
        locationId,
        bookingDate: new Date(),
      },
    }),
    
    // Status breakdown
    prisma.campaignBooking.groupBy({
      by: ["status"],
      where: { locationId },
      _count: true,
    }),
    
    // Total slots
    prisma.campaignSlot.count({
      where: { locationId },
    }),
    
    // Today's slots
    prisma.campaignSlot.findMany({
      where: {
        locationId,
        date: new Date(),
      },
    }),
  ]);

  const todayCapacity = todaySlots.reduce((sum, s) => sum + s.capacity, 0);
  const todayBooked = todaySlots.reduce((sum, s) => sum + s.bookedCount, 0);

  return {
    locationId,
    locationName: location.name,
    totalBookings,
    todayBookings,
    todayCapacity,
    todayBooked,
    todayAvailable: todayCapacity - todayBooked,
    totalSlots,
    statusBreakdown: Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count])
    ),
  };
}

/**
 * Get today's queue for a location
 */
export async function getTodayQueue(locationId: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookings = await prisma.campaignBooking.findMany({
    where: {
      locationId,
      bookingDate: today,
      status: { in: ["CHECKED_IN", "IN_PROGRESS"] },
    },
    include: {
      pets: true,
    },
    orderBy: { checkedInAt: "asc" },
  });

  return bookings.map((b, index) => ({
    queueNumber: b.queueNumber,
    ownerName: b.ownerName,
    petCount: b.pets.length,
    status: b.status,
    checkedInAt: b.checkedInAt,
    waitingMinutes: b.checkedInAt
      ? Math.floor((Date.now() - b.checkedInAt.getTime()) / 60000)
      : 0,
    position: index + 1,
  }));
}

/**
 * Get locations with availability for a date
 */
export async function getLocationsWithAvailability(
  campaignId: number,
  date: Date
) {
  const locations = await prisma.campaignLocation.findMany({
    where: {
      campaignId,
      isActive: true,
    },
    include: {
      slots: {
        where: {
          date,
          status: "OPEN",
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    availableSlots: loc.slots.length,
    totalAvailable: loc.slots.reduce(
      (sum, s) => sum + Math.max(0, s.capacity - s.bookedCount),
      0
    ),
    slots: loc.slots.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      available: s.capacity - s.bookedCount,
    })),
  }));
}

export type PublicCampaignLocationRow = {
  id: number;
  name: string;
  address: string | null;
  dailyCapacity: number;
  availableCapacity: number;
  /** @deprecated use availableCapacity */
  remainingCapacity: number;
  bookingCount: number;
  nextSlotDate: string | null;
  availableDates: string[];
  availableSlots: number;
  isAvailable: boolean;
  rolloutRegionId: number | null;
  coverageZoneId: number | null;
  coverageZoneName: string | null;
  bookingArea: string | null;
  coverageZones: string[];
};

/**
 * Public bookable locations for express checkout (V2 location picker).
 */
export async function listPublicCampaignLocations(
  resolve: { campaignSlug?: string; campaignId?: number },
  options: { onlyAvailable?: boolean } = {}
): Promise<PublicCampaignLocationRow[]> {
  const campaignId = await resolveCampaignId({
    campaignSlug: resolve.campaignSlug,
    campaignId: resolve.campaignId,
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, advanceBookingDays: true, minAdvanceHours: true },
  });
  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(campaignId);
  }

  const today = startOfDay(new Date());
  const horizon = addDays(today, campaign.advanceBookingDays);

  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId, isActive: true },
    include: {
      rolloutRegions: { where: { isActive: true }, take: 1 },
      _count: {
        select: {
          bookings: { where: { status: { notIn: ["CANCELLED"] } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const coverageByLocation = await resolveCoverageBatch(
    locations.map((l) => ({ id: l.id, addressJson: l.addressJson }))
  );

  if (locations.length === 0) {
    return [];
  }

  const locationIds = locations.map((l) => l.id);
  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId: { in: locationIds },
      status: "OPEN",
      date: { gte: today, lte: horizon },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const slotsByLocation = new Map<number, typeof slots>();
  for (const s of slots) {
    const list = slotsByLocation.get(s.locationId) ?? [];
    list.push(s);
    slotsByLocation.set(s.locationId, list);
  }

  const rows = locations.map((loc) => {
    const region = loc.rolloutRegions[0];
    const locSlots = slotsByLocation.get(loc.id) ?? [];
    const openSlots = locSlots.filter((s) => s.bookedCount < s.capacity);
    const slotRemaining = openSlots.reduce(
      (sum, s) => sum + Math.max(0, s.capacity - s.bookedCount),
      0
    );
    const regionRemaining =
      region && region.targetCapacity > 0
        ? Math.max(0, region.targetCapacity - region.bookedCount)
        : null;
    const remainingCapacity = regionRemaining ?? slotRemaining;
    const availableDates = [
      ...new Set(openSlots.map((s) => formatDate(s.date))),
    ].sort();
    const next = openSlots[0];

    const isAvailable = remainingCapacity > 0 && openSlots.length > 0;
    const cov = coverageByLocation.get(loc.id);
    const dailyCapacity = loc.dailyCapacity;
    const availableCapacity = Math.min(remainingCapacity, dailyCapacity);

    return {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      dailyCapacity,
      availableCapacity,
      remainingCapacity: availableCapacity,
      bookingCount: loc._count.bookings,
      nextSlotDate: next ? formatDate(next.date) : null,
      availableDates,
      availableSlots: openSlots.length,
      isAvailable,
      rolloutRegionId: region?.id ?? null,
      coverageZoneId: cov?.coverageZoneId ?? null,
      coverageZoneName: cov?.coverageZoneName ?? null,
      bookingArea: cov?.bookingArea ?? null,
      coverageZones: cov?.coverageZones ?? [],
    };
  });

  return options.onlyAvailable ? rows.filter((r) => r.isAvailable) : rows;
}

export default {
  createLocation,
  getLocationById,
  listLocations,
  updateLocation,
  deactivateLocation,
  getLocationStats,
  getTodayQueue,
  getLocationsWithAvailability,
  listPublicCampaignLocations,
};
