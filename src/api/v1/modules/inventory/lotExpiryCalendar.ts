/**
 * Calendar-day (UTC) expiry semantics for lot eligibility.
 * Lots with expDate on the same UTC calendar day as "now" remain eligible for that full day,
 * avoiding false "expired" when expDate is stored as midnight at the start of the expiry date.
 */

export function startOfUtcCalendarDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** True if the lot's expiry calendar day (UTC) is strictly before today's calendar day (UTC). */
export function isLotExpiredByCalendarDayUtc(lotExpDate: Date, now: Date = new Date()): boolean {
  return startOfUtcCalendarDay(lotExpDate).getTime() < startOfUtcCalendarDay(now).getTime();
}

/** Prisma filter: lot expiry calendar day is today or in the future (UTC). */
export function fefoLotExpDateEligibleFilter(): { gte: Date } {
  return { gte: startOfUtcCalendarDay(new Date()) };
}
