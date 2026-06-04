# Campaign slot session upgrade — migration plan

## Goal

Professional vaccination campaign scheduling: named sessions, check-in/cutoff times, locale-friendly time labels, bulk repeat patterns, and validation — without breaking existing `campaign_slots` rows.

## Schema change (additive only)

| Column | Type | Nullable | Legacy default |
|--------|------|----------|----------------|
| `sessionName` | `VARCHAR(120)` | YES | Inferred from `startTime` in API layer |
| `checkInStartTime` | `VARCHAR(5)` | YES | Treated as `startTime` when null |
| `bookingCutoffTime` | `VARCHAR(5)` | YES | Treated as `endTime` when null |

Migration: `20260604240000_campaign_slot_session_fields`

- No changes to unique key `(locationId, date, startTime)`
- No data backfill required; optional admin edit / new bulk creates populate fields

## API contract

### Create / bulk create (new optional fields)

- `sessionName` — e.g. "Morning Session"
- `checkInStartTime` — `HH:mm`
- `bookingCutoffTime` — `HH:mm`
- Bulk: `repeatPattern`: `DAILY` | `WEEKDAYS` | `WEEKENDS` | `CUSTOM`
- Bulk: `customDays` — `0–6` (Sun–Sat) when `CUSTOM`
- Legacy `excludeWeekends: true` maps to `WEEKDAYS` when `repeatPattern` omitted

### Response (all slot list endpoints)

Existing fields unchanged. Added:

- `sessionName`, `checkInStartTime`, `bookingCutoffTime`
- `remainingCapacity` (alias of `availableCount`)
- `startTimeLabel`, `endTimeLabel` (12-hour, locale from `Accept-Language` or `en-US`)

### Validation rules

1. `endTime` > `startTime`
2. `capacity` > 0
3. `bookingCutoffTime` < `endTime` (when set)
4. `checkInStartTime` <= `startTime` (when set)

Booking flow: reject new bookings after `bookingCutoffTime` on slot day (falls back to `endTime`).

## Touch points

| Layer | Files |
|-------|--------|
| DB | `prisma/schema.prisma`, migration SQL |
| Backend | `slot.schedule.ts`, `slot.service.ts`, `campaign.types.ts`, `campaign.validation.ts`, `booking.service.ts` |
| Admin UI | `bpa_web/app/admin/.../slots/page.tsx`, `lib/campaignApi.ts`, `lib/campaignSlotFormat.ts` |
| Public UI | `vaccination_2026` schedule step, confirm/success pages, `lib/campaignSlotFormat.ts` |

## Rollout

1. `node scripts/check-migration-integrity.js`
2. `npx prisma migrate deploy` (review SQL)
3. Deploy API → deploy `bpa_web` + `vaccination_2026`
4. Restart API; create test bulk slots with session name

## Rollback

Drop three nullable columns only if no production dependency; otherwise leave columns unused.
