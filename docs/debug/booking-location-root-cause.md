# Booking Location Root Cause — Production Bug

**Date:** 2026-06-07  
**Severity:** Critical  
**Symptom:** Admin bookings table shows `Location = —` after successful DSCC/DNCC + area checkout.

---

## Phase 1 — Reproduction Trace

### 1. Frontend payload (`/book`)

**File:** `vaccination_2026/components/booking/BookingWizard.tsx` (lines 204–218)

```json
{
  "campaignSlug": "<slug>",
  "phone": "01XXXXXXXXX",
  "cityCorporationCode": "DSCC",
  "bdAreaId": 27366,
  "bookingArea": "Rampura / Banasree",
  "catCount": 1,
  "paymentMethod": "BKASH"
}
```

Sent via `POST /api/v1/campaign/public/checkout/init`.

### 2. API validation

**File:** `campaign.validation.ts` — `checkoutInitSchema` accepts `cityCorporationCode` (DNCC|DSCC) + `bdAreaId`.

### 3. Controller input

**File:** `checkout.controller.ts` line 53 — `checkoutInitSchema.parse(req.body)` → `initCheckout(data)`.

### 4. Service resolution

**File:** `checkout.service.ts` lines 317–323

```typescript
zoneInterest = await resolveDhakaCorporationCoverage({
  cityCorporationCode: input.cityCorporationCode,
  bdAreaId: input.bdAreaId,
});
```

**File:** `dhakaBooking.service.ts` line 155 — `bookingArea = locality.nameEn` (e.g. `"Rampura / Banasree"`).

### 5. Prisma create data (paid flow)

**File:** `checkout.service.ts` lines 138–157 (`createPendingBookingForCheckout`)

| Field | Value |
|-------|-------|
| `locationId` | `null` |
| `bookingMode` | `ZONE_INTEREST` |
| `coverageZoneId` | resolved operational zone |
| `coverageZoneName` | e.g. `"Dhaka South City Corporation (DSCC)"` |
| `bdAreaId` | mapped internal area id |
| `bookingArea` | `"Rampura / Banasree"` |
| `ownerAddressJson` | `{ cityCorporationCode: "DSCC", bookingArea: "...", bookingMode: "ZONE_INTEREST" }` |

Free flow: same fields written in `fulfillCheckoutSession()` (lines 644–654).

### 6. Database row — **verified on local DB**

Example booking `VAC-WRS2Y9` (DSCC):

| Column | Stored value |
|--------|--------------|
| `locationId` | `null` |
| `venueId` | *(not a column — N/A)* |
| `cityCorporationId` | *(not a column — stored in JSON)* |
| `areaId` | *(not a column — `bdAreaId` = 27393)* |
| `bookingArea` | `"Paltan / Kakrail"` |
| `coverageZoneName` | `"Dhaka South City Corporation (DSCC)"` |
| `ownerAddressJson.cityCorporationCode` | `"DSCC"` |

Example DSCC zone `Rampura / Banasree` exists as BdArea id **27366** under `CC-DSCC`.

**Conclusion:** Location data **is persisted correctly**. No data loss at frontend → DB.

### 7. Booking list API response — **BEFORE fix**

**File:** `booking.controller.ts` lines 404–421

Returned raw Prisma rows. For zone bookings:

```json
{
  "locationId": null,
  "bookingArea": "Rampura / Banasree",
  "location": null
}
```

No `cityCorporation`, `area`, or `locationLabel` in response.

### 8. Admin table rendering — **BEFORE fix**

**File:** `bpa_web/app/admin/(larkon)/campaigns/[id]/bookings/page.tsx` line 77

```tsx
render: (r) => r.location?.name ?? '—'
```

Only reads `CampaignLocation.name`. Zone bookings always render **`—`**.

---

## Phase 2 — Database Schema Verification

### `CampaignBooking` relevant columns

| Column | Exists | Used for Dhaka flow |
|--------|--------|---------------------|
| `cityCorporationId` | **No** | Code in `ownerAddressJson.cityCorporationCode` |
| `areaId` | **No** | Customer area name in `bookingArea`; internal id in `bdAreaId` |
| `locationId` | Yes (nullable) | **Always null** for zone-interest |
| `venueId` | **No** | N/A |
| `bookingArea` | Yes | Customer-facing area label |
| `bdAreaId` | Yes | Internal BdArea mapping |
| `coverageZoneName` | Yes | Operational zone (not shown to customer) |
| `ownerAddressJson` | Yes | `cityCorporationCode`, `cityCorporationName`, `bookingArea` |

No migration required for persistence — schema already supports the data.

---

## Phase 3 — Root Cause (exact break point)

| Stage | Status | Evidence |
|-------|--------|----------|
| Frontend | ✅ OK | Sends `cityCorporationCode`, `bdAreaId`, `bookingArea` |
| Validation | ✅ OK | Schema accepts Dhaka fields |
| Controller | ✅ OK | Passes to `initCheckout` |
| Service | ✅ OK | Resolves + persists zone fields |
| Database | ✅ OK | `bookingArea` + JSON populated (see VAC-WRS2Y9) |
| **API response** | ❌ **BUG** | `listCampaignBookingsHandler` returned raw rows without location projection |
| **Admin UI** | ❌ **BUG** | Only displayed `location?.name` |

**Exact files/lines where value disappears from user view:**

1. `backend-api/src/api/v1/modules/campaign/booking.controller.ts:419-421` — raw Prisma items, no location enrichment
2. `bpa_web/app/admin/(larkon)/campaigns/[id]/bookings/page.tsx:77` — `r.location?.name ?? '—'`

The value never disappeared from the database — it was **never surfaced** to admin.

---

## Phase 4 — Fix Implemented

### Backend

| Change | File |
|--------|------|
| Location resolver + short label (`DSCC → Area`) | `bookingLocationDisplay.util.ts` |
| Admin list mapper with top-level fields | `booking.service.ts` → `mapBookingRecordToListRow()` |
| List handler uses mapper | `booking.controller.ts:421` |
| Detail/booking API enriched | `booking.service.ts` → `mapBookingRecordToDetails()` |
| Checkout persists `cityCorporationName` in JSON | `checkout.service.ts` → `buildAddressJson()` |
| Export uses `locationLabel` | `export.service.ts` |

### API response shape (after fix)

```json
{
  "bookingRef": "VAC-WRS2Y9",
  "cityCorporation": "Dhaka South City Corporation",
  "area": "Paltan / Kakrail",
  "locationLabel": "DSCC → Paltan / Kakrail",
  "location": {
    "name": "DSCC → Paltan / Kakrail",
    "cityCorporation": "Dhaka South City Corporation",
    "area": "Paltan / Kakrail",
    "locationLabel": "DSCC → Paltan / Kakrail"
  }
}
```

### Frontend admin

| Change | File |
|--------|------|
| Extended `CampaignBookingRow` type | `bpa_web/lib/campaignApi.ts` |
| `formatCampaignBookingLocation()` prefers `locationLabel` | `bpa_web/lib/campaignApi.ts` |
| Bookings table uses formatter | `bookings/page.tsx` |

---

## Phase 5 — Historical Data Migration

**Script:** `scripts/backfill-booking-location-fields.ts`

Recovers / normalizes:

- `ownerAddressJson.cityCorporationName` from code when missing
- `ownerAddressJson.bookingArea` from column when missing
- `bookingArea` column from BdArea parent ZONE name when empty

**Local run result:**

```
scanned: 3, updated: 3 (added cityCorporationName to address JSON)
```

Existing rows already had `bookingArea` populated — backfill adds display metadata for older JSON-only records.

---

## Phase 6 — Validation Evidence

### Unit tests

```
bookingLocationDisplay.util.test.ts — 5/5 passed
```

### DB + API mapper (existing production-like rows)

| bookingRef | DB bookingArea | oldAdminDisplay | new locationLabel |
|------------|----------------|-----------------|-------------------|
| VAC-FEDLA3 | Airport / Kawla | — | DNCC → Airport / Kawla |
| VAC-G5QR5A | Badda | — | DNCC → Badda |
| VAC-WRS2Y9 | Paltan / Kakrail | — | DSCC → Paltan / Kakrail |

Run: `npx ts-node --transpile-only scripts/verify-booking-location-e2e.ts`

### End-to-end chain

| Step | Result |
|------|--------|
| Frontend selection | DSCC + Rampura / Banasree (bdAreaId 27366) |
| DB persistence | ✅ Confirmed on existing DSCC rows |
| API list mapper | ✅ Returns `locationLabel: "DSCC → …"` |
| Admin table | ✅ `formatCampaignBookingLocation()` → no `—` when data exists |

---

## Deploy checklist

1. Deploy **backend-api** (API enrichment + checkout JSON name)
2. Deploy **bpa_web** admin (table formatter)
3. Run backfill on production:  
   `npx ts-node --transpile-only scripts/backfill-booking-location-fields.ts`
4. Verify admin bookings page for campaign with zone-interest rows
