# Campaign Booking V2 — Location Picker Implementation Report

**Date:** 2026-06-04  
**Status:** Shipped  
**Workspaces:** `backend-api`, `vaccination_2026`  
**Authority:** Implements **D3** from `docs/campaign-v2/master-architecture-plan.md`  
**Companion:** `docs/campaign-redesign/location-migration-report.md`

---

## 1. Objective

Replace the express booking **Division → District → Upazila** step with a **Campaign Location** picker sourced from active `CampaignLocation` rows (capacity/slots from rollout regions and open slots). Booking flow:

1. Mobile  
2. Location  
3. Date (+ time slot)  
4. Cat count  
5. Payment method → checkout  

Geo dropdowns are **removed from `/book`** only; pre-registration and locator sections keep BD hierarchy.

---

## 2. Summary of changes

| Layer | Change |
|-------|--------|
| **API** | `GET /api/v1/campaign/public/campaigns/:slug/locations` |
| **API** | `POST /checkout/init` accepts `locationId` + `slotId`; legacy `area` optional |
| **API** | `resolveAssignmentByLocation` + fulfillment reads `locationId`/`slotId` from `addressJson` |
| **Public UI** | 5-step wizard; `LocationPicker` cards (name, address, capacity, dates, slots) |
| **Unchanged** | `GET /locations/:locationId/slots`, `confirm-free`, payment redirect, claim |

No new Prisma migrations. No duplicate booking modules.

---

## 3. Backend

### 3.1 New endpoint

```
GET /api/v1/campaign/public/campaigns/:slug/locations?onlyAvailable=true
```

**Service:** `listPublicCampaignLocations` in `location.service.ts`

**Response fields per location:**

| Field | Source |
|-------|--------|
| `name`, `address` | `CampaignLocation` |
| `remainingCapacity` | Rollout region `targetCapacity - bookedCount` if set; else sum of open slot headroom |
| `bookingCount` | Non-cancelled bookings count |
| `nextSlotDate` | Earliest open slot date in booking window |
| `availableDates` | Distinct dates with open slots (`advanceBookingDays` horizon) |
| `availableSlots` | Count of open slot rows |
| `isAvailable` | Capacity > 0 and at least one open slot |
| `rolloutRegionId` | Linked active rollout region (if any) |
| `coverageZones` | `[]` (phase 2 — schema exists, not wired to campaign locations yet) |

### 3.2 Checkout init (express)

**Schema:** `checkoutInitSchema` — `locationId` + optional `slotId`; `area` optional (legacy); `fullAddress` optional when `locationId` set (defaults to venue address).

**Flow when `locationId` present:**

1. Validate location belongs to campaign and is active  
2. `resolveAssignmentByLocation({ locationId, slotId?, minAdvanceHours, advanceBookingDays })`  
3. Region capacity check if rollout region has `targetCapacity`  
4. Persist `addressJson` with `locationId`, `locationName`, `slotId`, `fullAddress`  

**Legacy path:** `area.divisionId/districtId/upazilaId` still calls `checkAreaActive` + `resolveAssignment` (pre-reg/locator unchanged).

### 3.3 Fulfillment

`fulfillCheckoutSession` reads `addressJson.locationId` / `slotId` and re-runs `resolveAssignmentByLocation` so the same slot is validated at payment completion (or next slot if `slotId` omitted).

### 3.4 Files touched (backend)

| File | Role |
|------|------|
| `location.service.ts` | `listPublicCampaignLocations` |
| `assignment.service.ts` | `resolveAssignmentByLocation`; `rolloutRegionId` nullable on result |
| `checkout.service.ts` | V2 init + address JSON + fulfill branch |
| `campaign.validation.ts` | `checkoutInitSchema` refine |
| `checkout.controller.ts` | `getPublicCampaignLocationsHandler` |
| `campaign.routes.ts` | Route registration (before `:slug` catch-all) |

---

## 4. Frontend (`vaccination_2026`)

### 4.1 Wizard steps

| Step | Component | Validates |
|------|-----------|-----------|
| 0 Mobile | `StepMobile.tsx` | BD phone |
| 1 Location | `StepLocationSelect.tsx` + `LocationPicker.tsx` | `locationId` |
| 2 Date | `StepSchedule.tsx` | `bookingDate`, `slotId` (slots from existing public API) |
| 3 Cats | `StepCatsCount.tsx` | `catCount` ≤ campaign max |
| 4 Pay | `StepPayDirect.tsx` | Coupon + payment method |
| 5 Done | `StepSuccess.tsx` | — |

**Draft key:** `bpa_booking_draft_v4` (invalidates geo-based drafts).

### 4.2 Removed from `/book`

- `LocationSelectorFields` in express flow  
- Required `divisionId` / `districtId` / `upazilaId` validation  

**Kept elsewhere:** `PreRegisterSection`, `CampaignLocatorSection`, `LocationSelectorFields` for pre-reg and discovery.

### 4.3 API client

- `fetchCampaignLocations(slug)`  
- `initCheckout({ locationId, slotId, phone, catCount, ... })`  

### 4.4 Files touched (frontend)

| File | Role |
|------|------|
| `components/booking/BookingWizard.tsx` | 5-step orchestration |
| `components/booking/LocationPicker.tsx` | Location cards |
| `components/booking/steps/StepMobile.tsx` | New |
| `components/booking/steps/StepLocationSelect.tsx` | New |
| `components/booking/steps/StepCatsCount.tsx` | New |
| `lib/bookingTypes.ts` | Steps + owner/location fields |
| `lib/bookingValidation.ts` | Per-step validators |
| `lib/campaignApi.ts` | Types + fetch/init |
| `app/globals.css` | `.booking-location-card` styles |
| `steps/StepContactArea.tsx` | `@deprecated` |

---

## 5. Validation checklist (express booking)

| Check | How to verify |
|-------|----------------|
| **Locations API** | `GET .../public/campaigns/{slug}/locations` returns active venues with capacity/dates |
| **Slots API** | After picking location, `GET .../locations/{id}/slots?startDate&endDate` populates date step |
| **Checkout init** | `POST .../checkout/init` with `locationId`, `slotId`, `phone`, `catCount` → `checkoutId`; free campaigns `requiresPayment: false` |
| **Confirm free** | `POST .../checkout/confirm-free` → `booking` + `verificationCode` |
| **Paid redirect** | Init with paid campaign → `paymentUrl`; return to `/book/success?checkoutId=` → poll `GET .../checkout/:id/status` until `FULFILLED` |
| **Legacy geo** | Init with `area` only (no `locationId`) still works for backward compatibility |
| **UI** | `/book` shows 5 progress labels; no Division/District/Upazila on booking steps |

### 5.1 Example init body (V2)

```json
{
  "campaignSlug": "uat-free-2026",
  "phone": "01700000000",
  "locationId": 1,
  "slotId": 42,
  "catCount": 2,
  "paymentMethod": "BKASH"
}
```

---

## 6. Data model notes

- **Campaign Locations** — bookable venues (`CampaignLocation`).  
- **Coverage zones** — platform `CoverageZone` not yet joined to campaign locations; UI label reserved; `coverageZones: []` until phase 2.  
- **Rollout regions** — still drive regional capacity when `locationId` is set on a region.

---

## 7. Follow-ups

- Wire `CoverageZone` badges on location cards (optional grouping).  
- Retire legacy `area`-only init default in a later flag (`CAMPAIGN_LEGACY_GEO_BOOKING=false`).  
- Server-side integration test for `checkout/init` + `confirm-free` with `locationId`.  
- Align `BookingProgress` “Done” step styling when `step === 5`.

---

## 8. References

- `docs/campaign-v2/master-architecture-plan.md` — D2 express-only, D3 locationId  
- `docs/campaign-redesign/location-migration-report.md` — detailed migration spec  
- `docs/campaign-v2/admin-v2-report.md` — admin shell (separate deliverable)
