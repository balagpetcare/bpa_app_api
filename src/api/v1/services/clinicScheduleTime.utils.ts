/**
 * Pure timezone/schedule time helpers (no DB). Used by clinicScheduleTime.service and slot generation.
 */

/** Default timezone for BPA Clinic branches when branch timezone is not configured. */
export const DEFAULT_CLINIC_TIMEZONE = "Asia/Dhaka";

/** Known IANA timezone -> offset in minutes (ahead of UTC). */
export const KNOWN_TZ_OFFSET_MINUTES: Record<string, number> = {
  "Asia/Dhaka": 360,
  "Asia/Kolkata": 330,
  "Asia/Colombo": 330,
  UTC: 0,
};

/**
 * Get timezone offset in minutes (e.g. +360 for Asia/Dhaka UTC+6).
 * Positive = ahead of UTC.
 */
export function getTimezoneOffsetMinutes(tz: string, _date?: Date): number {
  if (KNOWN_TZ_OFFSET_MINUTES[tz] !== undefined) {
    return KNOWN_TZ_OFFSET_MINUTES[tz];
  }
  return 0;
}

/**
 * Parse "HH:mm" or "H:mm" to { h, m }. Returns null if invalid.
 */
export function parseTimeHHmm(s: string): { h: number; m: number } | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  const [h, m] = trimmed.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/**
 * Convert a local date (YYYY-MM-DD) and time-of-day (HH:mm in branch TZ) to a UTC Date.
 */
export function localTimeToUTC(
  dateStr: string,
  time: { h: number; m: number },
  offsetMinutes: number
): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) {
    return new Date(NaN);
  }
  const localAsUTC = new Date(Date.UTC(y, mo - 1, d, time.h, time.m, 0, 0));
  return new Date(localAsUTC.getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Get day of week (0=Sun .. 6=Sat) for the given date in the branch timezone.
 */
export function getDayOfWeekInTimezone(dateStr: string, offsetMinutes: number): number {
  const utcInstant = localTimeToUTC(dateStr, { h: 0, m: 0 }, offsetMinutes).getTime();
  return new Date(utcInstant + offsetMinutes * 60 * 1000).getUTCDay();
}
