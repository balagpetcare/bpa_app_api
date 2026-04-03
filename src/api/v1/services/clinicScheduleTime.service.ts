/**
 * Clinic schedule timezone helpers.
 * Doctor weekly availability is stored as local wall-clock times (HH:mm).
 * Slot generation must interpret these in the branch/clinic timezone and produce
 * correct UTC timestamps so that clients display 09:00–17:00 local, not shifted.
 *
 * Pure helpers live in clinicScheduleTime.utils.ts (testable without DB).
 * getBranchTimezone reads from DB; when Branch has timezone field, use it here.
 */

const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

const {
  DEFAULT_CLINIC_TIMEZONE,
  getTimezoneOffsetMinutes,
  parseTimeHHmm,
  localTimeToUTC,
  getDayOfWeekInTimezone,
} = require("./clinicScheduleTime.utils");

export { DEFAULT_CLINIC_TIMEZONE, getTimezoneOffsetMinutes, parseTimeHHmm, localTimeToUTC, getDayOfWeekInTimezone };

/**
 * Get the IANA timezone for a branch (e.g. "Asia/Dhaka").
 * Currently returns DEFAULT_CLINIC_TIMEZONE for all branches.
 * Future: read from branch.timezone or org/country config.
 */
export async function getBranchTimezone(branchId: number): Promise<string> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) return DEFAULT_CLINIC_TIMEZONE;
  return DEFAULT_CLINIC_TIMEZONE;
}
