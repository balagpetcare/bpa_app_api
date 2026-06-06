# Booking Location Investigation

**Date:** 2026-06-07  
**Issue:** Admin bookings table shows `Location = —` for Dhaka corporation + area bookings (e.g. DSCC → Rampura / Banasree) even though checkout succeeds.

---

## Phase 1 — Data Flow Trace

| Step | Component | Finding |
|------|-----------|---------|
| 1. Frontend form | `vaccination_2026/components/booking/BookingWizard.tsx` | Sends `cityCorporationCode`, `bdAreaId`, `bookingArea` to `POST /campaign/public/checkout/init` |
| 2. API validation | `campaign.validation.ts` | Requires `cityCorporationCode` + `bdAreaId` for Dhaka zone-interest flow |
| 3. Checkout service | `checkout.service.ts` → `resolveDhakaCorporationCoverage()` | Resolves coverage zone + `bookingArea` (locality name) |
| 4. Persistence | `createPendingBookingForCheckout()` | Saves `bookingMode=ZONE_INTEREST`, `coverageZoneId`, `coverageZoneName`, `bdAreaId`, `bookingArea`, `ownerAddressJson` (includes `cityCorporationCode`) |
| 5. Fulfillment | `fulfillCheckoutSession()` | Re-applies zone fields from session `addressJson` on paid/free confirm |
| 6. Database | `CampaignBooking` | **No `locationId`** for zone-interest; location data lives in `bookingArea` + `ownerAddressJson` |
| 7. Admin list API | `GET /admin/campaigns/:id/bookings` | **Was returning raw Prisma rows** — `location` relation null for zone bookings |
| 8. Admin UI | `bpa_web/.../bookings/page.tsx` | **Only rendered `r.location?.name`** → always `—` when `locationId` is null |

### Answers

1. **Is frontend sending location fields?** Yes — `cityCorporationCode`, `bdAreaId`, `bookingArea`.
2. **Is backend receiving them?** Yes — validated and resolved in checkout init.
3. **Are they saved in database?** Yes — `bookingArea`, `coverageZoneName`, `bdAreaId`, and `cityCorporationCode` in `ownerAddressJson`.
4. **Are they returned by API?** **No (before fix)** — list endpoint exposed only `location: { id, name }` from `CampaignLocation`.
5. **Is frontend rendering correctly?** **No (before fix)** — admin table ignored `bookingArea` / corporation fields.

---

## Phase 2 — Database Schema

### `CampaignBooking` (relevant fields)

| Field | Type | Nullable | Purpose |
|-------|------|----------|---------|
| `locationId` | Int | Yes | FK → `CampaignLocation` (venue bookings only) |
| `bookingMode` | Enum | No | `VENUE` or `ZONE_INTEREST` |
| `coverageZoneId` | Int | Yes | Internal operational zone |
| `coverageZoneName` | String | Yes | Operational zone label |
| `bdAreaId` | Int | Yes | Mapped BdArea (may differ from customer-selected ZONE id) |
| `bookingArea` | String | Yes | **Customer-facing area name** (e.g. Rampura / Banasree) |
| `ownerAddressJson` | Json | Yes | Includes `cityCorporationCode`, `cityCorporationName`, `bookingArea` |

### Related models

- **CampaignLocation** — physical venue; used when `bookingMode = VENUE`.
- **BdArea** — hierarchy: CITY_CORPORATION → ZONE (customer locality) → AREA (internal mapping).
- **CoverageZone** — Dhaka metro operational zones (hidden from customers).
- **CityCorporation** — DNCC / DSCC master data.

### Missing mapping (before fix)

- No dedicated `cityCorporationId` / `cityCorporationName` columns on `CampaignBooking`.
- Corporation stored in `ownerAddressJson.cityCorporationCode` at checkout.
- Admin API did not project these fields into list response.

---

## Phase 3–5 — Fix Summary

### Backend

- Added `bookingLocationDisplay.util.ts` — resolves `{ cityCorporation, area }` from booking row + address JSON.
- Checkout now persists `cityCorporationName` in `ownerAddressJson` alongside code.
- `mapBookingRecordToDetails()` and new `mapBookingRecordToListRow()` enrich `location` with:
  - `cityCorporation`
  - `area`
  - `name` (formatted label, e.g. `DSCC → Rampura / Banasree`)
- Admin list handler maps all items through `mapBookingRecordToListRow`.
- Export CSV uses same display helper for `location_name`.

### Frontend (bpa_web)

- Extended `CampaignBookingRow.location` type with `cityCorporation` and `area`.
- Added `formatCampaignBookingLocation()` with fallbacks.
- Bookings table uses formatter instead of `location?.name` only.

### Database changes

**None required** — existing columns sufficient; corporation name added to checkout address JSON for new bookings.

---

## Root Cause

Zone-interest bookings intentionally have **`locationId = null`**. Data was persisted correctly in `bookingArea` and `ownerAddressJson`, but the **admin list API and UI only read the `CampaignLocation` relation**, producing `—` for all Dhaka corporation bookings.

---

## Files Modified

| Repo | File |
|------|------|
| backend-api | `src/api/v1/modules/campaign/bookingLocationDisplay.util.ts` (new) |
| backend-api | `src/api/v1/modules/campaign/bookingLocationDisplay.util.test.ts` (new) |
| backend-api | `src/api/v1/modules/campaign/booking.service.ts` |
| backend-api | `src/api/v1/modules/campaign/booking.controller.ts` |
| backend-api | `src/api/v1/modules/campaign/checkout.service.ts` |
| backend-api | `src/api/v1/modules/campaign/campaign.types.ts` |
| backend-api | `src/api/v1/modules/campaign/export.service.ts` |
| bpa_web | `lib/campaignApi.ts` |
| bpa_web | `app/admin/(larkon)/campaigns/[id]/bookings/page.tsx` |

---

## Validation

### Automated tests

```
PASS bookingLocationDisplay.util.test.ts — 4/4 tests
```

### Database spot-check script

When DB is available:

```bash
node scripts/verify-booking-location-display.js
```

Compares `oldAdminDisplay` (`location?.name ?? —`) vs `newAdminDisplay` for recent `ZONE_INTEREST` rows.

### Manual check after deploy

1. Create booking: DSCC + Rampura / Banasree.
2. Confirm DB row has `bookingArea` and `ownerAddressJson.cityCorporationCode`.
3. `GET /api/v1/admin/campaigns/:id/bookings` returns `location.area` and `location.cityCorporation`.
4. Admin table shows formatted location instead of `—`.
