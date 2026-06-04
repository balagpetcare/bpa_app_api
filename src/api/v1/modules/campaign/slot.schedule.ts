/**
 * Campaign slot scheduling: validation, session labels, locale time display, repeat patterns.
 */

import { parseTimeToMinutes } from "./campaign.utils";

export type SlotRepeatPattern = "DAILY" | "WEEKDAYS" | "WEEKENDS" | "CUSTOM";

export type SlotScheduleInput = {
  startTime: string;
  endTime: string;
  capacity: number;
  sessionName?: string | null;
  checkInStartTime?: string | null;
  bookingCutoffTime?: string | null;
};

export type CampaignSlotDto = {
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
  status: string;
};

const DEFAULT_LOCALE = "en-US";

export function pickTimeLocale(acceptLanguage?: string): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const primary = acceptLanguage.split(",")[0]?.trim().toLowerCase();
  if (primary?.startsWith("bn")) return "bn-BD";
  return DEFAULT_LOCALE;
}

/** 24h HH:mm → locale 12-hour label (e.g. 09:00 AM). */
export function formatCampaignTimeLabel(time: string, locale: string = DEFAULT_LOCALE): string {
  const mins = parseTimeToMinutes(time);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return d.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

/** Infer session label for legacy slots without sessionName. */
export function inferSessionDisplayName(startTime: string): string {
  const hour = Math.floor(parseTimeToMinutes(startTime) / 60);
  if (hour < 12) return "Morning Session";
  if (hour < 17) return "Afternoon Session";
  return "Evening Session";
}

export function resolveSessionName(stored: string | null | undefined, startTime: string): string {
  const t = stored?.trim();
  if (t) return t;
  return inferSessionDisplayName(startTime);
}

export function validateSlotSchedule(input: SlotScheduleInput): void {
  if (input.capacity <= 0) {
    throw new Error("Capacity must be greater than 0");
  }
  if (parseTimeToMinutes(input.endTime) <= parseTimeToMinutes(input.startTime)) {
    throw new Error("End time must be after start time");
  }

  const checkIn = input.checkInStartTime?.trim();
  if (checkIn && parseTimeToMinutes(checkIn) > parseTimeToMinutes(input.startTime)) {
    throw new Error("Check-in time must be at or before start time");
  }

  const cutoff = input.bookingCutoffTime?.trim();
  const effectiveCutoff = cutoff || input.endTime;
  if (parseTimeToMinutes(effectiveCutoff) > parseTimeToMinutes(input.endTime)) {
    throw new Error("Booking cutoff must be before or at end time");
  }
}

export function resolveRepeatPattern(
  repeatPattern?: SlotRepeatPattern,
  excludeWeekends?: boolean
): SlotRepeatPattern {
  if (repeatPattern) return repeatPattern;
  if (excludeWeekends) return "WEEKDAYS";
  return "DAILY";
}

export function shouldIncludeDateForRepeat(
  date: Date,
  pattern: SlotRepeatPattern,
  customDays?: number[]
): boolean {
  const day = date.getDay();
  switch (pattern) {
    case "DAILY":
      return true;
    case "WEEKDAYS":
      return day >= 1 && day <= 5;
    case "WEEKENDS":
      return day === 0 || day === 6;
    case "CUSTOM":
      return Array.isArray(customDays) && customDays.includes(day);
    default:
      return true;
  }
}

export function mapCampaignSlotToDto(
  slot: {
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
  },
  formatDate: (d: Date) => string,
  locale?: string
): CampaignSlotDto {
  const loc = locale || DEFAULT_LOCALE;
  const availableCount = Math.max(0, slot.capacity - slot.bookedCount);
  return {
    id: slot.id,
    slotId: slot.id,
    date: formatDate(slot.date),
    sessionName: resolveSessionName(slot.sessionName, slot.startTime),
    startTime: slot.startTime,
    endTime: slot.endTime,
    startTimeLabel: formatCampaignTimeLabel(slot.startTime, loc),
    endTimeLabel: formatCampaignTimeLabel(slot.endTime, loc),
    checkInStartTime: slot.checkInStartTime?.trim() || null,
    bookingCutoffTime: slot.bookingCutoffTime?.trim() || null,
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
    walkInCount: slot.walkInCount,
    availableCount,
    remainingCapacity: availableCount,
    status: slot.status,
  };
}

/** Whether local now is past booking cutoff on the slot date. */
export function isPastBookingCutoff(
  slotDate: Date,
  startTime: string,
  endTime: string,
  bookingCutoffTime: string | null | undefined,
  now: Date = new Date()
): boolean {
  const cutoff = bookingCutoffTime?.trim() || endTime;
  const d = new Date(slotDate);
  const [h, m] = cutoff.split(":").map(Number);
  d.setHours(h, m, 59, 999);
  return now > d;
}
