# Doctor Schedule Availability & Appointment Slot Timezone Fix

## 1. Root cause

- **What was wrong:** Template times (e.g. 09:00–17:00) are stored correctly as **local wall-clock** strings (`startTime`/`endTime` as "HH:mm") in `DoctorScheduleTemplate`. Slot generation, however, treated these as **UTC** when building `Date` instances:
  - `toDateAtTime(date, {h:9,m:0})` did `new Date(date + "T00:00:00.000Z")` then `setUTCHours(9,0,...)` → **09:00 UTC**.
  - Slots were returned as ISO strings (e.g. `2025-03-17T09:00:00.000Z`). In Bangladesh (UTC+6), the client’s `toLocaleTimeString()` then showed **15:00** (3 PM) instead of 09:00.
- **Why 09:00 became 15:00:** 09:00 UTC + 6 hours (Asia/Dhaka) = 15:00 local. So the same bug appears as a **+6 hour shift** on the appointment booking page and anywhere slots are rendered in local time.
- **Save/read of schedule:** Schedule **save** and **read** were already correct: the API sends and receives plain "09:00"/"17:00" strings; the schedule board and availability UI render these as-is. The **only** broken part was **slot generation** (treating template times as UTC).
- **Model:** The data model (dayOfWeek + startTime/endTime as "HH:mm") was already correct. The implementation of **slot generation** was wrong (UTC assumption). No schema change was required.

## 2. Files audited

| Area | File | Notes |
|------|------|--------|
| Schema | `prisma/schema.prisma` | DoctorScheduleTemplate: dayOfWeek, startTime/endTime String "HH:mm", slotMinutes — already correct |
| Backend slot generation | `src/api/v1/modules/clinic/appointment.service.ts` | getAvailableSlots used toDateAtTime (UTC) |
| Backend slot generation | `src/api/v1/services/appointmentAvailability.service.ts` | getAvailableSlots used toDateAtTime (UTC) |
| Backend schedule read/save | `src/api/v1/modules/doctor/doctor.service.ts` | getMySchedule/putMySchedule use raw strings — no conversion |
| Backend schedule board | `src/api/v1/services/staffDoctorManagement.service.ts` | getScheduleBoard returns templates as stored |
| Backend routes | `src/api/v1/modules/clinic/clinic.controller.ts` | getSlots, getBookingAvailableSlots return slots from services |
| Frontend schedule UI | `app/staff/.../doctors/schedule-board/page.tsx` | Renders t.startTime, t.endTime as strings — correct |
| Frontend schedule UI | `src/components/clinic/doctors/tabs/ScheduleTab.tsx` | Uses type="time" and string startTime/endTime — correct |
| Frontend slots | `app/staff/.../clinic/appointments/page.jsx` | Displays slots via new Date(s.start).toLocaleTimeString() — correct once API returns proper UTC |
| Frontend API | `lib/api.ts` | staffClinicSlots, staffBookingAvailableSlots — pass-through |
| Branch timezone | `prisma/schema.prisma` (Branch) | No timezone field; fallback used |

## 3. Files changed

| File | Change |
|------|--------|
| **New** `src/api/v1/services/clinicScheduleTime.utils.ts` | Pure helpers: parseTimeHHmm, getTimezoneOffsetMinutes, localTimeToUTC, getDayOfWeekInTimezone, KNOWN_TZ_OFFSET_MINUTES |
| **New** `src/api/v1/services/clinicScheduleTime.service.ts` | getBranchTimezone(branchId), re-exports from utils |
| **New** `src/api/v1/services/clinicScheduleTime.service.test.ts` | Tests for parseTimeHHmm, getTimezoneOffsetMinutes, localTimeToUTC, getDayOfWeekInTimezone |
| `src/api/v1/modules/clinic/appointment.service.ts` | getAvailableSlots: use getBranchTimezone, getTimezoneOffsetMinutes, getDayOfWeekInTimezone, localTimeToUTC; dateStart/dateEnd in branch local day; slot times built via localTimeToUTC |
| `src/api/v1/services/appointmentAvailability.service.ts` | Same: timezone-aware dayOfWeek, dateStart/dateEnd, and slot generation via localTimeToUTC |

No frontend code was changed. No schema or API contract change.

## 4. Schema / API contract changes

- **None.** Slots API still returns `{ start: string (ISO), end: string (ISO), doctorId?: number }`. The only change is that `start`/`end` are now **correct UTC** instants for the clinic’s local time (e.g. 09:00 Asia/Dhaka → 03:00 UTC), so client `toLocaleTimeString()` shows 09:00 in the clinic’s timezone.

## 5. How the fix works

1. **Branch timezone:** `getBranchTimezone(branchId)` returns `"Asia/Dhaka"` for all branches (no DB field yet). Isolated in one place for future branch/org timezone config.
2. **Offset:** `getTimezoneOffsetMinutes("Asia/Dhaka")` returns 360 (UTC+6). Other known zones can be added in `clinicScheduleTime.utils.ts`.
3. **Slot generation:** For a given `date` (YYYY-MM-DD) and template `startTime`/`endTime` ("09:00"/"17:00"):
   - `dayOfWeek` = `getDayOfWeekInTimezone(date, offsetMinutes)` so the calendar date in the clinic’s timezone matches the template’s day.
   - Each slot start is built as `localTimeToUTC(date, {h,m}, offsetMinutes)`, so 09:00 local → 03:00 UTC. Slots are then returned as ISO; the client displays them in local time and sees 09:00–17:00.
4. **Date range for existing appointments:** `dateStart`/`dateEnd` are the UTC range that covers “that calendar date” in the branch (midnight–23:59:59.999 local), so overlap checks remain correct.

## 6. Backward compatibility

- **Existing doctor schedule UI:** Unchanged; still sends/receives "HH:mm" strings. No shift on reload.
- **Existing appointment booking page:** Same API shape; slot labels now show correct local times (09:00 AM–05:00 PM instead of 03:00 PM–10:00 PM).
- **Stored templates:** No migration; all existing "09:00"/"17:00" data is interpreted as local time from now on.
- **Appointments already in DB:** Stored as UTC; comparison with new slots uses the same UTC range logic, so no change to existing bookings.

## 7. Risks and follow-up

- **Branch timezone:** Today every branch uses `"Asia/Dhaka"`. When Branch (or Org) gets a `timezone` (e.g. IANA) field, implement it in `getBranchTimezone()` and add the offset to `KNOWN_TZ_OFFSET_MINUTES` (or derive from Intl) so multi-timezone branches work.
- **DST:** Asia/Dhaka has no DST. If you add zones with DST, consider using a library (e.g. luxon/dayjs with timezone) or date-aware offset in `getTimezoneOffsetMinutes`.
- **Owner/doctor panel slots:** Any other call path that uses `appointment.service.getAvailableSlots` or `appointmentAvailability.service.getAvailableSlots` automatically gets the fix (e.g. owner clinic slots).

## 8. Exact examples after fix

- **Saved schedule:** Doctor sets 09:00 AM to 05:00 PM (stored as startTime "09:00", endTime "17:00").
- **Dashboard / schedule board:** Shows "09:00" – "17:00" (or "09:00 AM" – "05:00 PM" if formatted); no change, no shift.
- **Appointment page (Asia/Dhaka):** Slots are returned with start times as UTC equivalents of 09:00, 09:15, … 16:45 local (e.g. first slot `2025-03-17T03:00:00.000Z`). Client displays them in local time → **09:00 AM to 05:00 PM** local clinic time.

---

**Summary:** The bug was in **slot generation only** (treating template "HH:mm" as UTC). The fix adds a shared clinic timezone helper and uses it in both slot services so template times are interpreted in branch local time and converted to UTC for API responses. Schedule save/read and schema were left unchanged.
