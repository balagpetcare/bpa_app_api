# Campaign Location Booking V2 — Implementation Report

**Date:** 2026-06-04  
**Scope:** Express booking (`vaccination_2026`) + API (`backend-api`) + admin analytics (`bpa_web`)  
**Reference:** `master-architecture-plan.md`, `booking-v2-report.md`, `docs/location-system-migration/`, `docs/dhaka-metro-coverage/`

---

## Summary

Campaign express booking now uses **campaign-assigned locations** only (no Division / District / Upazila on the public wizard). Checkout persists **campaign location**, **coverage zone**, and **booking area**. Admin Operations Center analytics report bookings, cats, and revenue by location and by Dhaka metro **CoverageZone**.

No duplicate location master or booking flow was introduced.

---

## Phase 1 — Location source

| Item | Implementation |
|------|----------------|
| API | `GET /api/v1/campaign/public/campaigns/:slug/locations` |
| Service | `listPublicCampaignLocations()` in `location.service.ts` |
| Data | Active `CampaignLocation` rows for the campaign (e.g. Mirpur 10, Banani, Dhanmondi, Uttara sites) |
| Coverage | `coverageLocation.service.ts` resolves `CoverageZone` from `addressJson.coverageZoneId` or `bdAreaId` → `coverage_zone_areas` |
| Response fields | `dailyCapacity`, `availableCapacity`, `coverageZoneId`, `coverageZoneName`, `bookingArea`, `coverageZones[]` |

**Admin setup:** set on each location’s `addressJson` (no new location table):

```json
{
  "coverageZoneId": 12,
  "bdAreaId": 456,
  "bookingArea": "Mirpur 10"
}
```

Run `npm run seed:dhaka-city` and `npm run seed:coverage-zones` so metro zones and area mappings exist.

---

## Phase 2 — Booking form

| Item | Implementation |
|------|----------------|
| UI | `BookingWizard` step 2 — `StepLocationSelect` + `LocationPicker` |
| Removed from express flow | Division / District / Upazila (legacy fields remain on `OwnerDraft` for pre-reg/locator only) |
| Shown per location | Name, address, daily capacity, available capacity, coverage zone label |
| Draft | `bpa_booking_draft_v4` — `locationId`, `coverageZoneId`, `bookingArea` |

---

## Phase 3 — Checkout persistence

| Field | Storage |
|-------|---------|
| `campaignLocationId` | `addressJson.campaignLocationId` + `locationId` on session/booking |
| `coverageZoneId` | `addressJson` + `campaign_bookings.coverageZoneId` (FK → `coverage_zones`) |
| `bookingArea` | `addressJson` + `campaign_bookings.bookingArea` |
| API | `POST /api/v1/campaign/public/checkout/init` accepts `campaignLocationId`, `coverageZoneId`, `bookingArea` (aliases `locationId`) |
| Fulfillment | `fulfillCheckoutSession()` copies zone/area onto `CampaignBooking` |

**Migration (additive):** `prisma/migrations/20260604150000_campaign_booking_coverage_zone/migration.sql`

Apply on shared DB:

```bash
node scripts/check-migration-integrity.js
npx prisma migrate deploy
node scripts/check-migration-integrity.js
```

---

## Phase 4 — Admin analytics

| Metric | Endpoint / service |
|--------|-------------------|
| Bookings by location | `getBookingsByLocation` — bookings, cats, revenue |
| Revenue by location | `getRevenueByLocation` |
| Bookings by coverage zone | `getBookingsByCoverageZone` — groups by `coverageZoneId` (Dhaka metro), fallback by `bookingArea` |
| Dashboard | `GET /api/v1/campaign/admin/campaigns/:id/analytics` |
| UI | `CampaignOperationsCenter` → Analytics tab (tables updated) |

Legacy rollout regions are **no longer** labeled as “coverage zones” in admin UI.

---

## Phase 5 — Validation checklist

| Flow | Status | Notes |
|------|--------|-------|
| Express booking (5-step wizard) | Code-complete | `/book` — location → date/slot → cats → pay |
| Checkout init | Code-complete | Requires `campaignLocationId` + `slotId` |
| Free confirm | Code-complete | `confirm-free` → `fulfillCheckoutSession` |
| Paid redirect | Code-complete | Unchanged payment intent path |
| Claim booking | Unchanged | Phone + ref + verification code |
| Admin analytics | Code-complete | Revenue/zone columns; needs bookings with `coverageZoneId` after migration |
| Typecheck | Passed | `backend-api` + `vaccination_2026` `tsc --noEmit` |

**Manual QA (recommended after `migrate deploy`):**

1. Ensure campaign has ≥1 active location with `addressJson.coverageZoneId` or `bdAreaId`.
2. Open vaccination site `/book` → pick location → verify daily/available capacity.
3. Complete free checkout → inspect booking row: `locationId`, `coverageZoneId`, `bookingArea`.
4. Operations Center → Analytics → verify location and coverage zone tables.

---

## Touch points (files)

### backend-api

- `src/api/v1/modules/campaign/coverageLocation.service.ts` (new)
- `src/api/v1/modules/campaign/location.service.ts`
- `src/api/v1/modules/campaign/checkout.service.ts`
- `src/api/v1/modules/campaign/campaign.validation.ts`
- `src/api/v1/modules/campaign/analytics.service.ts`
- `src/api/v1/modules/campaign/export.service.ts`
- `src/api/v1/modules/campaign/campaign.types.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260604150000_campaign_booking_coverage_zone/migration.sql`

### vaccination_2026

- `components/booking/LocationPicker.tsx`
- `components/booking/steps/StepLocationSelect.tsx`
- `components/booking/BookingWizard.tsx`
- `lib/campaignApi.ts`
- `lib/bookingTypes.ts`

### bpa_web

- `lib/campaignApi.ts`
- `src/bpa/campaign/admin/CampaignOperationsCenter.tsx`

---

## What was not done (by design)

- No new location tables or parallel booking APIs
- No Division/District/Upazila on express `/book` (legacy `booking-areas` + rollout remain for other flows)
- No automatic backfill of `coverageZoneId` on historical bookings (optional one-off script if needed)

---

## Related docs

- `docs/campaign-v2/booking-v2-report.md` — wizard UX baseline
- `docs/campaign-v2/operations-center-report.md` — admin hub
- `docs/dhaka-metro-coverage/README.md` — metro zone seeding
