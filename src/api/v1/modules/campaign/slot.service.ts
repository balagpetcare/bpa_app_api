/**
 * Campaign Slot Service
 * Manages time slots for vaccination appointments
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignSlotStatus, Prisma } from "@prisma/client";
import {
  CreateSlotInput,
  BulkCreateSlotsInput,
  SlotAvailability,
} from "./campaign.types";
import { SlotErrors, LocationErrors } from "./campaign.errors";
import {
  isValidTimeFormat,
  isValidTimeRange,
  startOfDay,
  addDays,
  formatDate,
} from "./campaign.utils";
import {
  mapCampaignSlotToDto,
  pickTimeLocale,
  resolveRepeatPattern,
  shouldIncludeDateForRepeat,
  validateSlotSchedule,
} from "./slot.schedule";

function assertSchedule(input: {
  startTime: string;
  endTime: string;
  capacity: number;
  sessionName?: string | null;
  checkInStartTime?: string | null;
  bookingCutoffTime?: string | null;
}) {
  try {
    validateSlotSchedule(input);
  } catch (e) {
    throw SlotErrors.SCHEDULE_INVALID(e instanceof Error ? e.message : "Invalid slot schedule");
  }
}

function sessionDataFromInput(
  input: {
    sessionName?: string;
    checkInStartTime?: string;
    bookingCutoffTime?: string;
  },
  slotDef?: {
    sessionName?: string;
    checkInStartTime?: string;
    bookingCutoffTime?: string;
  }
) {
  const sessionName = (slotDef?.sessionName ?? input.sessionName)?.trim() || null;
  const checkInStartTime = (slotDef?.checkInStartTime ?? input.checkInStartTime)?.trim() || null;
  const bookingCutoffTime = (slotDef?.bookingCutoffTime ?? input.bookingCutoffTime)?.trim() || null;
  return { sessionName, checkInStartTime, bookingCutoffTime };
}

// ============================================================================
// Slot CRUD
// ============================================================================

/**
 * Create a single slot
 */
export async function createSlot(input: CreateSlotInput) {
  const location = await prisma.campaignLocation.findUnique({
    where: { id: input.locationId },
  });

  if (!location) {
    throw LocationErrors.NOT_FOUND(input.locationId);
  }

  if (!isValidTimeFormat(input.startTime) || !isValidTimeFormat(input.endTime)) {
    throw SlotErrors.INVALID_TIME();
  }

  if (!isValidTimeRange(input.startTime, input.endTime)) {
    throw SlotErrors.INVALID_TIME();
  }

  const capacity = input.capacity ?? 50;
  const session = sessionDataFromInput(input);

  assertSchedule({
    startTime: input.startTime,
    endTime: input.endTime,
    capacity,
    ...session,
  });

  const existing = await prisma.campaignSlot.findUnique({
    where: {
      locationId_date_startTime: {
        locationId: input.locationId,
        date: startOfDay(input.date),
        startTime: input.startTime,
      },
    },
  });

  if (existing) {
    throw SlotErrors.DUPLICATE();
  }

  const created = await prisma.campaignSlot.create({
    data: {
      locationId: input.locationId,
      date: startOfDay(input.date),
      startTime: input.startTime,
      endTime: input.endTime,
      capacity,
      sessionName: session.sessionName,
      checkInStartTime: session.checkInStartTime,
      bookingCutoffTime: session.bookingCutoffTime,
      status: "OPEN",
    },
  });

  return mapCampaignSlotToDto(created, formatDate);
}

/**
 * Bulk create slots for a date range
 */
export async function bulkCreateSlots(input: BulkCreateSlotsInput) {
  const location = await prisma.campaignLocation.findUnique({
    where: { id: input.locationId },
    include: { campaign: true },
  });

  if (!location) {
    throw LocationErrors.NOT_FOUND(input.locationId);
  }

  const pattern = resolveRepeatPattern(input.repeatPattern, input.excludeWeekends);
  const slots: Prisma.CampaignSlotCreateManyInput[] = [];
  let currentDate = startOfDay(input.startDate);
  const endDate = startOfDay(input.endDate);

  while (currentDate <= endDate) {
    if (!shouldIncludeDateForRepeat(currentDate, pattern, input.customDays)) {
      currentDate = addDays(currentDate, 1);
      continue;
    }

    for (const slotDef of input.slots) {
      const capacity = slotDef.capacity ?? 50;
      const session = sessionDataFromInput(input, slotDef);

      assertSchedule({
        startTime: slotDef.startTime,
        endTime: slotDef.endTime,
        capacity,
        ...session,
      });

      slots.push({
        locationId: input.locationId,
        date: new Date(currentDate),
        startTime: slotDef.startTime,
        endTime: slotDef.endTime,
        capacity,
        sessionName: session.sessionName,
        checkInStartTime: session.checkInStartTime,
        bookingCutoffTime: session.bookingCutoffTime,
        status: "OPEN",
      });
    }

    currentDate = addDays(currentDate, 1);
  }

  const result = await prisma.campaignSlot.createMany({
    data: slots,
    skipDuplicates: true,
  });

  return {
    created: result.count,
    total: slots.length,
    repeatPattern: pattern,
  };
}

/**
 * Validate CampaignSlot.id before any Prisma access.
 */
export function assertValidSlotId(id: unknown, operation: string): number {
  const slotId = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(slotId) || slotId <= 0) {
    console.warn(`[CampaignSlot] ${operation}: invalid slotId`, { id, parsed: slotId });
    throw SlotErrors.INVALID_ID(id);
  }
  return slotId;
}

/**
 * Get slot by ID
 */
export async function getSlotById(id: number) {
  const slotId = assertValidSlotId(id, "getSlotById");
  const slot = await prisma.campaignSlot.findUnique({
    where: { id: slotId },
    include: {
      location: {
        include: { campaign: true },
      },
    },
  });

  if (!slot) {
    throw SlotErrors.NOT_FOUND(slotId);
  }

  return slot;
}

/**
 * Update slot
 */
export async function updateSlot(
  id: number,
  data: {
    capacity?: number;
    status?: CampaignSlotStatus;
    startTime?: string;
    endTime?: string;
    sessionName?: string;
    checkInStartTime?: string | null;
    bookingCutoffTime?: string | null;
  }
) {
  const slot = await getSlotById(id);

  const startTime = data.startTime ?? slot.startTime;
  const endTime = data.endTime ?? slot.endTime;
  const capacity = data.capacity ?? slot.capacity;

  if (data.startTime || data.endTime) {
    if (!isValidTimeFormat(startTime) || !isValidTimeFormat(endTime)) {
      throw SlotErrors.INVALID_TIME();
    }
    if (!isValidTimeRange(startTime, endTime)) {
      throw SlotErrors.INVALID_TIME();
    }
  }

  assertSchedule({
    startTime,
    endTime,
    capacity,
    sessionName: data.sessionName ?? slot.sessionName,
    checkInStartTime: data.checkInStartTime !== undefined ? data.checkInStartTime : slot.checkInStartTime,
    bookingCutoffTime:
      data.bookingCutoffTime !== undefined ? data.bookingCutoffTime : slot.bookingCutoffTime,
  });

  if (data.capacity !== undefined && data.capacity < slot.bookedCount) {
    throw new Error(`Cannot reduce capacity below ${slot.bookedCount} (currently booked)`);
  }

  const slotId = assertValidSlotId(id, "updateSlot");

  const updated = await prisma.campaignSlot.update({
    where: { id: slotId },
    data,
  });

  return mapCampaignSlotToDto(updated, formatDate);
}

/**
 * Close a slot (prevent new bookings)
 */
export async function closeSlot(id: number) {
  const slotId = assertValidSlotId(id, "closeSlot");
  console.info(`[CampaignSlot] closeSlot slotId=${slotId}`);
  return updateSlot(slotId, { status: "CLOSED" });
}

/**
 * Re-open a closed slot for new bookings
 */
export async function openSlot(id: number) {
  const slotId = assertValidSlotId(id, "openSlot");
  console.info(`[CampaignSlot] openSlot slotId=${slotId}`);
  return updateSlot(slotId, { status: "OPEN" });
}

/**
 * Cancel a slot
 */
export async function cancelSlot(id: number) {
  const slot = await getSlotById(id);

  if (slot.bookedCount > 0) {
    throw new Error("Cannot cancel slot with existing bookings");
  }

  return updateSlot(id, { status: "CANCELLED" });
}

// ============================================================================
// Slot Availability
// ============================================================================

function toSlotDtos(
  slots: Array<{
    id: number;
    date: Date;
    startTime: string;
    endTime: string;
    sessionName?: string | null;
    checkInStartTime?: string | null;
    bookingCutoffTime?: string | null;
    capacity: number;
    bookedCount: number;
    walkInCount: number;
    status: string;
  }>,
  locale?: string
): SlotAvailability[] {
  return slots.map((s) => mapCampaignSlotToDto(s, formatDate, locale));
}

/**
 * List all slots for a location (admin) — includes CLOSED/CANCELLED.
 */
export async function listLocationSlots(
  locationId: number,
  startDate: Date,
  endDate: Date,
  locale?: string
) {
  if (!Number.isInteger(locationId) || locationId <= 0) {
    throw LocationErrors.NOT_FOUND(locationId);
  }

  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: {
        gte: startOfDay(startDate),
        lte: startOfDay(endDate),
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return toSlotDtos(slots, locale);
}

/**
 * Get available slots for a location on a date range
 */
export async function getAvailableSlots(
  locationId: number,
  startDate: Date,
  endDate: Date,
  locale?: string
): Promise<SlotAvailability[]> {
  const slots = await prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: {
        gte: startOfDay(startDate),
        lte: startOfDay(endDate),
      },
      status: { in: ["OPEN", "FULL"] },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return toSlotDtos(slots, locale);
}

/**
 * Get slots for a campaign across all locations
 */
export async function getCampaignSlots(
  campaignId: number,
  date?: Date,
  locale?: string
): Promise<SlotAvailability[]> {
  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId, isActive: true },
    select: { id: true },
  });

  const locationIds = locations.map((l) => l.id);

  const where: Prisma.CampaignSlotWhereInput = {
    locationId: { in: locationIds },
  };

  if (date) {
    where.date = startOfDay(date);
  }

  const slots = await prisma.campaignSlot.findMany({
    where,
    include: {
      location: {
        select: { id: true, name: true },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return toSlotDtos(slots, locale);
}

/**
 * Get today's slots for a location
 */
export async function getTodaySlots(locationId: number) {
  const today = startOfDay(new Date());

  return prisma.campaignSlot.findMany({
    where: {
      locationId,
      date: today,
    },
    orderBy: { startTime: "asc" },
  });
}

/**
 * Check if a slot has capacity
 */
export async function hasCapacity(slotId: number): Promise<boolean> {
  const id = assertValidSlotId(slotId, "hasCapacity");
  const slot = await prisma.campaignSlot.findUnique({
    where: { id },
  });

  if (!slot) {
    return false;
  }

  return slot.status === "OPEN" && slot.bookedCount < slot.capacity;
}

export { pickTimeLocale };

export default {
  createSlot,
  bulkCreateSlots,
  getSlotById,
  updateSlot,
  closeSlot,
  openSlot,
  cancelSlot,
  listLocationSlots,
  getAvailableSlots,
  getCampaignSlots,
  getTodaySlots,
  hasCapacity,
};
