# Booking — Location Selection Migration Report

**Project:** BPA 2026 Cat Flu + Rabies Vaccination Campaign  
**Date:** 2026-06-04  
**Status:** Planning only — no code modified.  
**Companion:** `docs/campaign-redesign/master-plan.md`

---

## 1. Objective

Replace the current **3-field geographic chooser** (Division → District → Upazila) in the public booking flow with a **single Campaign Location picker** sourced from active **`CampaignLocation`** rows (augmented with **`CampaignRolloutRegion`** / **`CoverageZone`** metadata where present).

| | Old | New |
|---|-----|-----|
| User chooses | Division → District → Upazila | A Campaign Location card |
| UI controls | 3 dropdowns + free-form address | Searchable / grouped list of Location cards + free-form address |
| Backend resolves | Division/District/Upazila → Rollout Region → Location → Slot | `locationId` → Rollout Region (via location’s region) → Slot |
| Per-card display | n/a | **Name · Address · Remaining Capacity · Booking Count** |

This is a **planning** document — execution must follow `BPA_STANDARD.md` (no destructive Prisma migrations, no UI redesign outside WowDash patterns, update-only patches, additive-only schema changes).

---

## 2. Current State (verified)

### 2.1 Frontend (`vaccination_2026`)

| Component / file | Role | Uses Div/Dist/Upz? |
|------------------|------|--------------------|
| `app/book/page.tsx` | Booking entry | Indirect (renders wizard) |
| `components/booking/BookingWizard.tsx` | 3-step orchestrator | **Yes** — reads `owner.divisionId/districtId/upazilaId` from draft and posts to `initCheckout({ area })` |
| `components/booking/steps/StepContactArea.tsx` | Step 1 (active) | **Yes** — renders `LocationSelectorFields` |
| `components/booking/steps/StepQuickStart.tsx` | Legacy (unused) | Yes |
| `components/landing/LocationSelectorFields.tsx` | Shared geo cascade | **Yes** — primary consumer |
| `components/landing/PreRegisterSection.tsx` | Inactive-area pre-reg | Yes (intentional — pre-reg uses geo) |
| `components/landing/CampaignLocatorSection.tsx` | Locator search | Yes (intentional) |
| `components/landing/CampaignScheduleSection.tsx` | Calendar / list | Yes (intentional) |
| `lib/bookingTypes.ts` | `OwnerDraft`, `BookingDraft` | **Yes** — `divisionId`, `districtId`, `upazilaId` required |
| `lib/bookingValidation.ts` | `validateContactArea` | **Yes** — errors if missing |
| `lib/useLocationData.ts` | React Query loaders for BD geo | Yes |
| `lib/campaignApi.ts` | `BookableArea`, `initCheckout`, `submitPreRegistration` types | **Yes** |

### 2.2 Backend (`backend-api`)

| File | Role | Uses Div/Dist/Upz in booking path? |
|------|------|------------------------------------|
| `src/api/v1/modules/campaign/campaign.validation.ts` `checkoutInitSchema` | Zod schema | **Yes** — `area.divisionId` + `area.districtId` required, `upazilaId` optional |
| `src/api/v1/modules/campaign/checkout.service.ts` `initCheckout` / `fulfillCheckoutSession` | Booking creation | **Yes** — `buildAddressJson`, `checkAreaActive`, `resolveAssignment` |
| `src/api/v1/modules/campaign/assignment.service.ts` `resolveAssignment` | Region → Location → Slot | **Yes** — driven by `divisionId/districtId/upazilaId` |
| `src/api/v1/modules/campaign/rollout.service.ts` `checkAreaActive`, `listBookableAreas`, `listBdDivisions/Districts/Upazilas` | Geo activation, BD lookup | **Yes** (intentional for rollout) |
| `src/api/v1/modules/campaign/location.service.ts` | Location CRUD + availability | **Limited** — `addressJson` may store `divisionId/districtId/upazilaId` but not required |
| Schema `CampaignBooking.ownerAddressJson` | Persisted address | Currently `{ divisionId, districtId, upazilaId, division, district, upazila, fullAddress, alternatePhone }` |
| Schema `CampaignCheckoutSession.addressJson` | Persisted checkout intent | Same shape |
| Schema `CampaignRolloutRegion` | Region container | Holds `divisionId/districtId/upazilaId` (Int, no FK) + optional `locationId` |

### 2.3 Current request → fulfillment flow

```
StepContactArea (UI)
  └─ owner = { phone, divisionId, districtId, upazilaId, fullAddress, alternatePhone }
  └─ catCount

POST /api/v1/campaign/public/checkout/init
  body.area = { divisionId, districtId, upazilaId?, division?, district?, upazila? }
  → checkAreaActive(campaignId, divisionId, districtId, upazilaId)
  → resolveAssignment(...)
      ├─ resolveRolloutRegion (by divisionId + districtId + optional upazilaId)
      ├─ resolveLocationForRegion (region.locationId OR first matching by district in addressJson)
      └─ findNextAvailableSlot (location.id)
  → create CampaignCheckoutSession { rolloutRegionId, addressJson }
  → optional payment redirect

[Gateway webhook] or POST /checkout/confirm-free
  → fulfillCheckoutSession(checkoutSessionId)
      ├─ resolveAssignment AGAIN (so region/slot may differ if state changed)
      ├─ create CampaignBooking { locationId, slotId, rolloutRegionId, checkoutSessionId, ownerAddressJson }
      ├─ slot.bookedCount += 1; region.bookedCount += catCount
      └─ sendBookingConfirmation()
```

### 2.4 What “Coverage Zones” means today

The schema has a **`CoverageZone` family** (`coverage_zones`, `coverage_zone_areas`, `coverage_zone_metadata`) that maps zones to BD geo (area / union / upazila / district), with metadata like estimated pet population. **It is not currently used by the campaign module** (no service-layer references; no campaign route consumes it). The analytics helper `getBookingsByCoverageZone` is **misnamed**: it actually reads `CampaignRolloutRegion`.

So today, **two structures function as “coverage zones” in the campaign context:**

| Source | Purpose | In booking flow today |
|--------|---------|-----------------------|
| **`CampaignLocation`** | Concrete venue (name, address, lat/lng, dailyCapacity, slots) | **Yes** — auto-assigned at fulfillment |
| **`CampaignRolloutRegion`** | National rollout unit (division/district/upazila + targetCapacity + bookedCount, optional `locationId`) | **Yes** — drives area gating and region capacity |
| **`CoverageZone`** (generic, schema) | Service zones (metro / city corporation / operational) with BD-geo associations | **No** — orphan in campaign code |

This migration treats **“Campaign Location”** as the canonical bookable unit and exposes **Rollout Region capacity** as the “Remaining Capacity” signal. **`CoverageZone` is reserved as an optional grouping / badge** in a follow-up phase (see §11.2).

---

## 3. Target State

### 3.1 New UI for Step 1

Replace `LocationSelectorFields` (3 cascading dropdowns) with a **Location Picker** component listing all bookable locations for the active campaign. Each row/card displays:

| Field | Source |
|-------|--------|
| **Location Name** | `CampaignLocation.name` |
| **Address** | `CampaignLocation.address` (fallback to formatted `addressJson`) |
| **Remaining Capacity** | `rolloutRegion.targetCapacity - rolloutRegion.bookedCount` if region has a target; else aggregate of OPEN slot remaining (`Σ (slot.capacity - slot.bookedCount)`) in next `advanceBookingDays` window |
| **Booking Count** | `Σ bookings at this location` excluding `CANCELLED` (live count or denormalized) |
| Optional badge | Coverage Zone name(s) when zone mapping is enabled (phase 2) |
| Optional sub-line | Next available slot date/time when computed |
| Disabled state | `remainingCapacity <= 0` OR `region.isActive === false` OR no future OPEN slot |

The step continues to collect: **phone**, **full address (text)**, **alternate contact (optional)**, **cat count**, plus the new **`locationId`** selection.

Removed from Step 1 UI:

- Division dropdown
- District dropdown
- Upazila dropdown

Kept:

- Full address textarea (for staff handover, certificate, SMS context)
- Alternate phone
- Cat count

### 3.2 Persistence shape

`CampaignBooking.ownerAddressJson` and `CampaignCheckoutSession.addressJson` adopt a forward-compatible shape:

```ts
{
  fullAddress: string;
  alternatePhone?: string;
  // Optional — captured from the chosen location at the time of booking
  locationId?: number;
  locationName?: string;
  locationAddress?: string;
  // Legacy fields — still written when known, no longer required
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  division?: string;
  district?: string;
  upazila?: string;
}
```

Existing rows remain valid. New rows may omit `divisionId/districtId/upazilaId`.

### 3.3 New checkout request shape

```ts
POST /api/v1/campaign/public/checkout/init
{
  campaignSlug: "uat-free-2026",
  phone: "01XXXXXXXXX",
  alternatePhone?: "01YYYYYYYYY",
  locationId: 42,                  // NEW — primary geo signal
  fullAddress: "House 12, Road 5, Dhanmondi, Dhaka",
  catCount: 2,
  couponCode?: "BPA2026",
  paymentMethod?: "BKASH",
  returnUrl?: "...",
  cancelUrl?: "...",

  // DEPRECATED but accepted (back-compat, ignored when locationId present):
  area?: { divisionId, districtId, upazilaId? }
}
```

**Selection rule (server):**

1. If `locationId` is present → validate location belongs to campaign, is active, has capacity, has a future OPEN slot. Resolve `rolloutRegionId` from `CampaignLocation.rolloutRegions[0]` or from `addressJson` match.
2. Else if `area` is present → use existing `resolveAssignment` path (legacy).
3. Else → 400 `LOCATION_REQUIRED`.

### 3.4 New listing endpoint

```
GET /api/v1/campaign/public/campaigns/:slug/locations
  ?available=true     (default true — filter to bookable)
  &coverageZoneId=    (optional — when zone grouping is enabled)
```

Returns:

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "name": "BPA Mirpur Vaccination Centre",
      "address": "House 21, Mirpur-10, Dhaka",
      "addressJson": { "division": "Dhaka", "district": "Dhaka", "upazila": "Mirpur", "area": "Mirpur-10" },
      "latitude": 23.806,
      "longitude": 90.367,
      "remainingCapacity": 73,
      "bookingCount": 127,
      "nextSlotDate": "2026-06-08",
      "nextSlotStartTime": "09:30",
      "isAvailable": true,
      "rolloutRegionId": 5,
      "coverageZones": [{ "id": 3, "name": "Dhaka Metro", "slug": "dhaka-metro" }],
      "contactPhone": "+88017XXXXXXXX",
      "contactName": "Dr. Rahman"
    }
  ]
}
```

The endpoint is **public** (no auth) so it can be called from the landing page. Rate-limited and cacheable (60-second cache by campaign + filter).

### 3.5 Source unification

The handler MUST aggregate from **both** sources to populate `remainingCapacity` and `bookingCount`:

| Field | Formula |
|-------|---------|
| `remainingCapacity` | `max(0, region.targetCapacity - region.bookedCount)` if the location is linked to an active region; **else** `Σ (slot.capacity - slot.bookedCount)` for OPEN slots in the campaign window |
| `bookingCount` | `prisma.campaignBooking.count({ where: { locationId, status: { notIn: ["CANCELLED"] } } })` |
| `isAvailable` | `location.isActive && (region?.isActive ?? true) && nextSlot exists && remainingCapacity > 0` |
| `nextSlotDate/Time` | First OPEN slot with capacity in `[today, today + advanceBookingDays]` respecting `minAdvanceHours` |

If a location has **no rollout region** (e.g. ad-hoc venue), `remainingCapacity` falls back to the slot aggregate; the booking still proceeds without region accounting.

### 3.6 Coverage Zones role (phase 2 — optional)

When enabled, locations can carry zero or more `coverageZones` (computed via existing `LocationCoverageAssignment` or a new optional join table — see §10). The picker can:

- **Group** locations by zone name (e.g. "Dhaka Metro" group with 6 locations)
- **Filter** by zone (e.g. user picks "Chittagong City Corporation")
- **Display** zone badges on cards

No new mandatory schema — zones remain optional metadata.

---

## 4. Removed fields & UI elements

### 4.1 UI removals (`vaccination_2026`)

| Removed | File |
|---------|------|
| `LocationSelectorFields` invocation in `StepContactArea.tsx` | `components/booking/steps/StepContactArea.tsx` |
| Division/District/Upazila copy strings under `t.book.division`, `t.book.district`, "Upazila" | `lib/i18n/messages.ts` (booking subset only — landing/pre-reg/locator copy retained) |
| Field-level error rendering for `divisionId`, `districtId`, `upazilaId` | `StepContactArea.tsx` |
| `useDivisions()`, `useDistricts(divisionId)`, `useUpazilas(districtId)` calls **inside booking step only** (kept in landing locator + pre-reg) | `StepContactArea.tsx` |

### 4.2 Type / validation removals (booking only)

| Removed (booking flow) | Kept (other flows) |
|------------------------|---------------------|
| `OwnerDraft.divisionId/districtId/upazilaId` required → made optional in `BookingDraft` | Same fields still required in `PreRegisterSection`, `CampaignLocatorSection` |
| `validateContactArea` Division/District/Upazila checks | `validateContactArea` adds `locationId` required |
| `BookingDraft.owner.{division, district, upazila}` names | Kept (optional, captured server-side for back-compat) |

### 4.3 Backend removals

**Nothing is deleted.** `checkAreaActive`, `resolveAssignment`, `listBdDivisions/Districts/Upazilas`, `checkRolloutArea`, `submitPreRegistration` are all **kept** — they remain used by:

- Pre-registration (`/pre-register`)
- Landing locator (`/discovery/locator`)
- Admin rollout pages
- Demand intelligence

`checkoutInitSchema.area` becomes optional (back-compat only). Legacy callers keep working.

---

## 5. Backend API changes

### 5.1 New endpoint

```
GET /api/v1/campaign/public/campaigns/:slug/locations
```

Service implementation outline (additive — new file `location-listing.service.ts` OR extension to `location.service.ts`):

```ts
export async function listPublicCampaignLocations(
  campaignId: number,
  options: { onlyAvailable?: boolean; coverageZoneId?: number } = {}
) {
  const locations = await prisma.campaignLocation.findMany({
    where: { campaignId, isActive: true },
    include: {
      rolloutRegions: { where: { isActive: true } },
      _count: { select: { bookings: { where: { status: { notIn: ["CANCELLED"] } } } } },
    },
    orderBy: { name: "asc" },
  });

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw CampaignErrors.NOT_FOUND(campaignId);

  const today = startOfDay(new Date());
  const horizon = addDays(today, campaign.advanceBookingDays);

  const slotAgg = await prisma.campaignSlot.groupBy({
    by: ["locationId"],
    where: {
      campaignId,
      status: "OPEN",
      date: { gte: today, lte: horizon },
    },
    _sum: { capacity: true, bookedCount: true },
    _min: { date: true },
  });

  // Optional: coverage-zone lookup (phase 2)
  // const zones = await fetchZonesForLocations(locations.map(l => l.id));

  return locations.map((loc) => {
    const region = loc.rolloutRegions[0];
    const slotRow = slotAgg.find((s) => s.locationId === loc.id);
    const slotRemaining = (slotRow?._sum.capacity ?? 0) - (slotRow?._sum.bookedCount ?? 0);
    const regionRemaining = region && region.targetCapacity > 0
      ? Math.max(0, region.targetCapacity - region.bookedCount)
      : null;
    const remainingCapacity = regionRemaining ?? slotRemaining;
    const isAvailable = remainingCapacity > 0 && Boolean(slotRow?._min.date);
    return {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      addressJson: loc.addressJson,
      latitude: loc.latitude,
      longitude: loc.longitude,
      contactName: loc.contactName,
      contactPhone: loc.contactPhone,
      remainingCapacity,
      bookingCount: loc._count.bookings,
      nextSlotDate: slotRow?._min.date,
      isAvailable,
      rolloutRegionId: region?.id ?? null,
      coverageZones: [], // populated in phase 2
    };
  })
  .filter((l) => (options.onlyAvailable ? l.isAvailable : true));
}
```

**Caching:** wrap in a 60-second campaign-keyed cache (Redis or in-memory) — values change on every booking but small staleness is acceptable for the picker.

### 5.2 Modified validation schema

`campaign.validation.ts`:

```ts
export const checkoutInitSchema = z.object({
  campaignSlug: z.string().min(1).max(100).optional(),
  campaignId: z.number().int().optional(),
  phone: phoneSchema,
  alternatePhone: phoneSchema.optional(),

  // NEW — primary path
  locationId: z.number().int().optional(),

  // DEPRECATED — accepted for back-compat
  area: z.object({
    divisionId: z.number().int(),
    districtId: z.number().int(),
    upazilaId: z.number().int().optional(),
    division: z.string().max(100).optional(),
    district: z.string().max(100).optional(),
    upazila: z.string().max(100).optional(),
  }).optional(),

  fullAddress: z.string().trim().min(10).max(500),
  catCount: z.number().int().min(1).max(10),
  couponCode: z.string().max(32).optional(),
  paymentMethod: z.enum(["BKASH", "NAGAD", "CARD", "SSLCOMMERZ"]).optional(),
  returnUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
})
.refine((d) => Boolean(d.locationId || d.area), {
  message: "Either locationId or area must be provided",
  path: ["locationId"],
});
```

### 5.3 Modified `checkout.service.ts` (`initCheckout`)

```
if (input.locationId) {
  const location = await prisma.campaignLocation.findUnique({
    where: { id: input.locationId },
    include: { rolloutRegions: { where: { isActive: true } } },
  });
  if (!location || location.campaignId !== campaignId || !location.isActive) {
    throw LocationErrors.NOT_FOUND(input.locationId);
  }
  const region = location.rolloutRegions[0] ?? null;
  if (region && region.targetCapacity > 0) {
    const remaining = region.targetCapacity - region.bookedCount;
    if (input.catCount > remaining) throw AreaErrors.FULL();
  }
  const slot = await findNextAvailableSlot({
    locationId: location.id,
    campaignId,
    minAdvanceHours: campaign.minAdvanceHours,
    advanceBookingDays: campaign.advanceBookingDays,
  });
  assignment = {
    rolloutRegionId: region?.id ?? null,
    locationId: location.id,
    slotId: slot.id,
    locationName: location.name,
    slotDate: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
} else {
  // legacy path (existing resolveAssignment)
  assignment = await resolveAssignment({ ... });
}
```

`buildAddressJson` becomes:

```ts
function buildAddressJson(input, location?: { id: number; name: string; address?: string }) {
  return {
    fullAddress: input.fullAddress.trim(),
    alternatePhone: input.alternatePhone ? normalizePhone(input.alternatePhone) : undefined,
    ...(location ? { locationId: location.id, locationName: location.name, locationAddress: location.address } : {}),
    ...(input.area ? {
      divisionId: input.area.divisionId,
      districtId: input.area.districtId,
      upazilaId: input.area.upazilaId ?? null,
      division: input.area.division ?? "",
      district: input.area.district ?? "",
      upazila: input.area.upazila ?? "",
    } : {}),
  };
}
```

`rolloutRegionId` becomes **nullable** on `CampaignCheckoutSession`. (Already nullable in schema — `Int?` — no migration needed.)

### 5.4 Modified `assignment.service.ts`

Add a new helper `resolveAssignmentByLocation` and refactor `resolveAssignment` to accept either `{ divisionId, districtId, upazilaId }` **or** `{ locationId }`:

```ts
export async function resolveAssignment(input:
  | { campaignId: number; locationId: number; minAdvanceHours: number; advanceBookingDays: number }
  | { campaignId: number; divisionId: number; districtId: number; upazilaId?: number; minAdvanceHours: number; advanceBookingDays: number }
): Promise<AssignmentResult> { /* dispatch */ }
```

Existing callers of the geo-based variant (`fulfillCheckoutSession`) keep working until the session payload carries `locationId` (which it does after R2 of this migration — see §8).

### 5.5 Modified `fulfillCheckoutSession`

```ts
const address = session.addressJson as { locationId?: number; divisionId?: number; districtId?: number; upazilaId?: number | null; fullAddress: string };

const assignment = address.locationId
  ? await resolveAssignment({
      campaignId: session.campaignId,
      locationId: address.locationId,
      minAdvanceHours: session.campaign.minAdvanceHours,
      advanceBookingDays: session.campaign.advanceBookingDays,
    })
  : await resolveAssignment({
      campaignId: session.campaignId,
      divisionId: address.divisionId!,
      districtId: address.districtId!,
      upazilaId: address.upazilaId ?? undefined,
      minAdvanceHours: session.campaign.minAdvanceHours,
      advanceBookingDays: session.campaign.advanceBookingDays,
    });
```

Region capacity update remains conditional on `region` being non-null.

### 5.6 Schema impact

| Change | Type | Migration risk |
|--------|------|---------------|
| `CampaignBooking.ownerAddressJson` shape extension | JSON shape only — **no DDL** | None |
| `CampaignCheckoutSession.addressJson` shape extension | JSON shape only — **no DDL** | None |
| `CampaignCheckoutSession.rolloutRegionId` becomes optional in code | Already `Int?` in schema — **no DDL** | None |
| Optional: new join table `CampaignLocationCoverageZone(locationId, coverageZoneId, sortOrder)` — **phase 2 only** | Additive | Low |
| Optional: rename of `getBookingsByCoverageZone` analytics function for clarity | Code rename | None — back-compat alias possible |

**No destructive Prisma operation required.** No `migrate reset`, no `db push`, no edits to applied migrations — fully compatible with `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.

---

## 6. Frontend changes (`vaccination_2026`)

### 6.1 New component: `LocationPicker`

`components/booking/LocationPicker.tsx` (new file):

- Loads `GET /public/campaigns/:slug/locations` via React Query
- Renders a grid/list of selectable cards (WowDash card pattern, mobile-first)
- Each card shows: name, address, remaining badge, booking count, disabled state if `!isAvailable`
- Optional search box (filter by name / address substring) when count > 8
- Optional grouping by Coverage Zone (phase 2)
- Emits `onSelect(locationId, locationSnapshot)` to parent

### 6.2 Modified `StepContactArea.tsx`

- Remove import of `LocationSelectorFields`
- Add import of `LocationPicker`
- Replace the Division/District/Upazila block (lines 97–130 in current file) with the picker
- Show selected location summary card above the address field
- Validation: `locationId` required; `fullAddress` min 10 chars; phone; catCount

### 6.3 Modified `lib/bookingTypes.ts`

```ts
export type OwnerDraft = {
  phone: string;
  alternatePhone: string;
  name?: string;
  fullAddress: string;
  // NEW
  locationId: number | "";
  locationName: string;
  locationAddress: string;
  // DEPRECATED — kept optional for backward-compat reads of older drafts
  divisionId?: number | "";
  districtId?: number | "";
  upazilaId?: number | "";
  division?: string;
  district?: string;
  upazila?: string;
};

export const DRAFT_STORAGE_KEY = "bpa_booking_draft_v4"; // bumped to invalidate old drafts
```

### 6.4 Modified `lib/bookingValidation.ts`

```ts
export function validateContactArea(input: {
  phone: string;
  alternatePhone: string;
  locationId: number | "";
  fullAddress: string;
  catCount: number;
  maxCats: number;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  // phone, alternatePhone, fullAddress, catCount — unchanged
  if (!input.locationId) errors.locationId = "Select a vaccination location";
  return errors;
}
```

### 6.5 Modified `BookingWizard.tsx`

`handlePayConfirm` posts:

```ts
const result = await initCheckout({
  campaignSlug: SLUG,
  phone: owner.phone,
  alternatePhone: owner.alternatePhone.trim() || undefined,
  locationId: Number(owner.locationId),
  fullAddress: owner.fullAddress,
  catCount: draft.catCount,
  couponCode: draft.appliedCouponCode || undefined,
  paymentMethod: draft.paymentMethod,
});
```

### 6.6 Modified `lib/campaignApi.ts`

Add:

```ts
export type CampaignLocationRow = {
  id: number;
  name: string;
  address?: string | null;
  addressJson?: Record<string, unknown> | null;
  latitude?: number | null;
  longitude?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  remainingCapacity: number;
  bookingCount: number;
  nextSlotDate?: string | null;
  isAvailable: boolean;
  rolloutRegionId?: number | null;
  coverageZones?: Array<{ id: number; name: string; slug: string }>;
};

export async function fetchCampaignLocations(slug: string): Promise<CampaignLocationRow[]> {
  const res = await apiGet<{ success: boolean; data: CampaignLocationRow[] }>(
    `${pub}/campaigns/${encodeURIComponent(slug)}/locations`
  );
  return unwrap(res);
}

// Update initCheckout payload type:
export type CheckoutInitPayload = {
  // ...existing
  locationId?: number;             // NEW
  area?: { ... };                  // DEPRECATED
};
```

### 6.7 Files NOT changed (intentionally)

`LocationSelectorFields.tsx`, `PreRegisterSection.tsx`, `CampaignLocatorSection.tsx`, `CampaignScheduleSection.tsx`, `useLocationData.ts` — these continue to use Division/District/Upazila because **pre-registration, locator search, schedule view, and admin demand intelligence still need geographic filters**. The migration is scoped to the **booking flow only**.

---

## 7. Validation matrix — booking flow end-to-end

Each row is a concrete validation that must pass after migration. Marked **✓** = no change; **○** = updated by migration.

### 7.1 Public booking happy path (free campaign)

| # | Step | Validation | Status after migration |
|---|------|------------|------------------------|
| 1 | Landing → Book | `/book` renders `BookingWizard` | ✓ |
| 2 | Step 0 loads `LocationPicker` | `GET /public/campaigns/:slug/locations` returns ≥1 available row | ○ — new endpoint |
| 3 | User picks a location | Card click sets `draft.owner.locationId`, `locationName`, `locationAddress` | ○ |
| 4 | User enters phone, full address, cat count | `validateContactArea` returns no errors | ○ — `locationId` required, Div/Dist/Upz removed |
| 5 | Continue | `POST /checkout/init` with `{ locationId, ... }` succeeds → session created | ○ — server accepts `locationId` |
| 6 | Free path → `POST /checkout/confirm-free` | Returns `bookingRef` + `verificationCode` | ✓ |
| 7 | Booking persisted | `CampaignBooking.locationId`, `slotId`, `rolloutRegionId` (nullable) set | ○ — `rolloutRegionId` may be `null` |
| 8 | `ownerAddressJson` shape | Contains `fullAddress`, `locationId`, `locationName`, `locationAddress`; no Div/Dist/Upz unless legacy | ○ |
| 9 | Slot counter increments | `slot.bookedCount += 1` | ✓ |
| 10 | Region counter increments (if region present) | `region.bookedCount += catCount` | ○ — skipped if `region === null` |
| 11 | Booking confirmation SMS | `BOOKING_CONFIRMED` sent with ref + verification code | ✓ |
| 12 | Step 2 — Success | `StepSuccess` shows QR + ref + code | ✓ |

### 7.2 Public booking happy path (paid)

| # | Step | Validation | Status |
|---|------|------------|--------|
| 1 | `POST /checkout/init` with `locationId` | Returns `paymentUrl`, session `PENDING` | ○ |
| 2 | Gateway redirect | unchanged | ✓ |
| 3 | Webhook arrives | `fulfillCheckoutFromOrder` finds session, reads `addressJson.locationId`, calls `resolveAssignment({ locationId })` | ○ |
| 4 | Booking row created | `locationId` matches `addressJson.locationId` | ○ |
| 5 | SMS sent | unchanged | ✓ |
| 6 | `/book/success?checkoutId=` poll | `GET /checkout/:id/status` returns `bookingRef`, `verificationCode`, `booking.location.name` | ✓ |

### 7.3 Negative & edge cases

| # | Case | Expected |
|---|------|----------|
| 1 | Picker called for inactive campaign | 404 NOT_FOUND |
| 2 | All locations full | Picker returns empty `data: []` when `available=true`; UI shows "No locations available — pre-register" CTA |
| 3 | Selected location goes full between init and pay | At `fulfillCheckoutSession`, `findNextAvailableSlot` throws `SLOT_NOT_AVAILABLE` → checkout marked `FAILED`; user sees retry; payment refund path applies (manual today, see master plan R5) |
| 4 | Selected location has region with no capacity | `initCheckout` rejects with `AREA_FULL` (existing error reused) |
| 5 | `locationId` belongs to another campaign | `LocationErrors.NOT_FOUND` |
| 6 | Both `locationId` and `area` sent | `locationId` wins; `area` stored only as supplementary `addressJson` for back-compat |
| 7 | Neither `locationId` nor `area` sent | Zod refine: `LOCATION_REQUIRED` |
| 8 | Legacy client sends only `area` | Existing flow runs — back-compat preserved |
| 9 | Draft from older `bpa_booking_draft_v3` (with Div/Dist/Upz) | Draft key bumped to `v4`; old drafts ignored — user starts fresh |
| 10 | Selected location is inactive after picker load | Server validates `isActive` at init; UI shows "Location no longer available" |
| 11 | Selected location has no future slot | `findNextAvailableSlot` throws → user gets `NO_AVAILABILITY` |
| 12 | Two users pick the last seat | Serializable transaction in `fulfillCheckoutSession` ensures only one wins |

### 7.4 Claim & post-booking

| # | Flow | Status |
|---|------|--------|
| 1 | `POST /public/booking/claim` (phone + ref + code) | ✓ — no Div/Dist/Upz dependency |
| 2 | `/booking/[ref]` (session-only today) | ✓ — unchanged (see master plan R5.5 for server fetch) |
| 3 | `/verify/certificate` | ✓ — unchanged |

### 7.5 Pre-registration (not part of migration)

| # | Flow | Status |
|---|------|--------|
| 1 | `PreRegisterSection` (inactive area CTA) | ✓ — **still uses Division/District/Upazila** (intentional — pre-reg is geographic) |
| 2 | `POST /pre-register` | ✓ — unchanged |
| 3 | Locator (`#locator`) and Schedule (`#schedule`) | ✓ — unchanged |

### 7.6 Staff & admin

| # | Flow | Status |
|---|------|--------|
| 1 | Staff `check-in`, `walk-in`, `record-vaccination` | ✓ — no Div/Dist/Upz dependency in lifecycle code |
| 2 | Admin bookings table | ✓ — already shows `location.name` |
| 3 | Admin rollout regions page | ✓ — unchanged (still drives capacity & pre-reg) |
| 4 | Admin demand intelligence | ✓ — uses `ownerAddressJson` district matching; gracefully degrades when address has no district (already today) |
| 5 | Analytics `getBookingsByCoverageZone` | ✓ — still reads `CampaignRolloutRegion`; rename deferred to master plan R4 |

### 7.7 SMS templates

| Template | Variables used | Migration impact |
|----------|----------------|------------------|
| `BOOKING_CONFIRMED` | `{bookingRef}`, `{verificationCode}`, optional location name | ○ — payload now includes location name reliably |
| `VACCINATION_COMPLETE` | `{certUrl}` | ✓ |
| `BOOKING_CANCELLED` / `NO_SHOW` | `{bookingRef}` | ✓ |
| `REMINDER_24H` / `REMINDER_2H` | `{locationName}`, `{slotTime}` | ✓ — already reads from booking row |
| `CAMPAIGN_PREREG_OPEN` | `{districtName}` | ✓ — pre-reg path unchanged |

### 7.8 Backward compatibility

| Legacy caller | Behaviour |
|---------------|-----------|
| Old `vaccination_2026` build sending `area` only | Works — server falls through to `resolveAssignment(area)` |
| Old draft in user's `sessionStorage` (`bpa_booking_draft_v3`) | Ignored (key bumped to `v4`) — user starts fresh |
| Direct API caller using legacy `area` shape | Continues to work; `locationId` is opt-in |
| Existing `CampaignBooking` rows with full geo `ownerAddressJson` | Untouched; reads work |

---

## 8. Phased execution plan

Each phase is **update-only**, **additive Prisma**, **feature-flag gated** where it can break a user. Pure planning here — no code modified.

### Phase L1 — Backend listing endpoint (1 day)

| # | Task | Touch points |
|---|------|--------------|
| L1.1 | Add `listPublicCampaignLocations` service | `src/api/v1/modules/campaign/location.service.ts` |
| L1.2 | Add `GET /public/campaigns/:slug/locations` route + handler | `campaign.routes.ts`, `location.controller.ts` (new) or inline |
| L1.3 | Add 60-second cache wrapper (Redis or in-memory) | same |
| L1.4 | Unit test: returns expected fields and respects `available=true` filter | `__tests__/` |

**Acceptance:** Hitting the endpoint for the active campaign returns ≥1 row with all the required fields. Inactive locations excluded by default.

### Phase L2 — Backend init accepts `locationId` (1 day)

| # | Task | Touch points |
|---|------|--------------|
| L2.1 | Extend `checkoutInitSchema` with optional `locationId` + Zod refine | `campaign.validation.ts` |
| L2.2 | Extend `initCheckout` to dispatch on `locationId` | `checkout.service.ts` |
| L2.3 | Extend `resolveAssignment` to accept `{ locationId }` | `assignment.service.ts` |
| L2.4 | Extend `buildAddressJson` to embed `locationId/locationName/locationAddress` and accept legacy `area` simultaneously | `checkout.service.ts` |
| L2.5 | Extend `fulfillCheckoutSession` to read `addressJson.locationId` first | `checkout.service.ts` |
| L2.6 | Add `LocationErrors.NOT_FOUND` to existing error class — already exists | `campaign.errors.ts` |
| L2.7 | Postman / Supertest coverage: location-based init succeeds; legacy area init still works | `__tests__/` |

**Acceptance:** New + legacy payloads both produce valid bookings. Existing rows still readable.

### Phase L3 — Frontend `LocationPicker` (2 days)

| # | Task | Touch points |
|---|------|--------------|
| L3.1 | Add `fetchCampaignLocations` + `CampaignLocationRow` type | `vaccination_2026/lib/campaignApi.ts` |
| L3.2 | Add `LocationPicker.tsx` (WowDash card pattern, mobile-first) | `vaccination_2026/components/booking/LocationPicker.tsx` |
| L3.3 | Rewrite `StepContactArea.tsx` to use `LocationPicker` + simplified address fields | `vaccination_2026/components/booking/steps/StepContactArea.tsx` |
| L3.4 | Update `OwnerDraft` + `BookingDraft` types; bump `DRAFT_STORAGE_KEY` to `v4` | `vaccination_2026/lib/bookingTypes.ts` |
| L3.5 | Update `validateContactArea` to require `locationId`, drop Div/Dist/Upz | `vaccination_2026/lib/bookingValidation.ts` |
| L3.6 | Update `BookingWizard.handlePayConfirm` to send `locationId` | `vaccination_2026/components/booking/BookingWizard.tsx` |
| L3.7 | i18n strings (Bangla + English) for new picker labels | `vaccination_2026/lib/i18n/messages.ts` (booking subset) |
| L3.8 | Mobile + accessibility QA pass | — |

**Acceptance:** A new booking on `/book` succeeds end-to-end using only the new picker. SMS confirmation arrives with correct location name. Legacy components (`LocationSelectorFields`, pre-reg, locator) remain visually unchanged.

### Phase L4 — Cleanup & docs (½ day)

| # | Task | Touch points |
|---|------|--------------|
| L4.1 | Mark legacy step files as deprecated (`StepQuickStart`, geo block) but **do not delete** | comments only |
| L4.2 | Remove `LocationSelectorFields` import from `StepContactArea` (keep file — used elsewhere) | — |
| L4.3 | Update `master-plan.md` + this report (status table) | `docs/campaign-redesign/*.md` |
| L4.4 | Update `IMPLEMENTATION_PROGRESS.md` with new endpoint + UI | `docs/vaccination-campaign-2026/` |
| L4.5 | Add `BUG-241 Booking location flow simplified` row | `docs/vaccination-campaign-2026/03-BUG-LIST.md` |

### Phase L5 — Optional Coverage Zone enrichment (2 days — deferred)

| # | Task | Touch points |
|---|------|--------------|
| L5.1 | Add `CampaignLocationCoverageZone` join table (Prisma migration, additive) | `prisma/schema.prisma`, new migration |
| L5.2 | Admin UI to assign zones to a location | `bpa_web/app/admin/(larkon)/campaigns/[id]/locations/page.tsx` |
| L5.3 | Extend `listPublicCampaignLocations` to include `coverageZones[]` | `location.service.ts` |
| L5.4 | Picker shows zone badge + optional zone filter | `LocationPicker.tsx` |

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| User picks a location → location fills before fulfillment → payment without booking | Low (express checkout already has this race) | Init validates capacity; `fulfillCheckoutSession` re-validates; failed fulfill → session FAILED → manual refund per master plan R5.3 |
| Slot counter stays at `+= 1 per booking` (overbooking risk per master plan §0.2.2) | Same as today | Unaffected by this migration; addressed in master-plan R5.1 |
| Operator forgets to attach rollout region to a new location → `remainingCapacity` falls back to slot aggregate | Low | Documented; admin UI surfaces "no region" warning |
| Locations list grows large (100+) | Low for 2026 pilot | Picker has search; cache 60s; pagination optional |
| Legacy clients still send `area` only | Expected | `area` accepted; back-compat preserved |
| Older sessionStorage drafts confuse users | Low | Bump `DRAFT_STORAGE_KEY` to `v4` |
| Localization gap in picker | Low | i18n keys added in L3.7 |
| Picker shows locations with no future slots | Low | `available=true` default filter |

---

## 10. Schema decision — Coverage Zone wiring (deferred)

If/when phase L5 runs, the recommended **additive** migration:

```prisma
model CampaignLocationCoverageZone {
  id              Int             @id @default(autoincrement())
  campaignLocationId Int
  coverageZoneId  Int
  sortOrder       Int             @default(0)
  createdAt       DateTime        @default(now())

  campaignLocation CampaignLocation @relation(fields: [campaignLocationId], references: [id], onDelete: Cascade)
  coverageZone     CoverageZone     @relation(fields: [coverageZoneId], references: [id], onDelete: Cascade)

  @@unique([campaignLocationId, coverageZoneId])
  @@index([coverageZoneId])
  @@map("campaign_location_coverage_zones")
}
```

Also add a back-relation on `CampaignLocation` (`coverageZones CampaignLocationCoverageZone[]`) and `CoverageZone` (`campaignLocations CampaignLocationCoverageZone[]`). **No existing data is touched.**

Alternative (no schema change): reuse `LocationCoverageAssignment` with a new `entityType` value `"CAMPAIGN_LOCATION"` and `entityId = campaignLocation.id`. This avoids a new table but requires extending the `LocationCoverageEntityType` enum — also additive.

Either approach is **outside the scope of this migration’s core deliverable**.

---

## 11. Touch-point index (file-by-file)

### 11.1 `backend-api`

```
src/api/v1/modules/campaign/
  campaign.validation.ts      [MODIFY] add locationId, refine schema
  checkout.service.ts         [MODIFY] dispatch on locationId; buildAddressJson; fulfillCheckoutSession
  assignment.service.ts       [MODIFY] overload resolveAssignment with locationId variant
  location.service.ts         [MODIFY] add listPublicCampaignLocations
  campaign.routes.ts          [MODIFY] add GET /public/campaigns/:slug/locations
  campaign.types.ts           [MODIFY] optional — add PublicCampaignLocationRow type
  campaign.errors.ts          [no change] LocationErrors already present
prisma/schema.prisma          [no change required] — JSON shape only
docs/campaign-redesign/
  location-migration-report.md [this file]
  master-plan.md               [reference]
docs/vaccination-campaign-2026/
  IMPLEMENTATION_PROGRESS.md   [MODIFY in L4]
  03-BUG-LIST.md               [MODIFY in L4 — add BUG-241]
```

### 11.2 `vaccination_2026`

```
lib/
  campaignApi.ts              [MODIFY] add fetchCampaignLocations + CampaignLocationRow + locationId on init payload
  bookingTypes.ts             [MODIFY] OwnerDraft locationId; bump DRAFT_STORAGE_KEY to v4
  bookingValidation.ts        [MODIFY] validateContactArea requires locationId; drop Div/Dist/Upz checks
  i18n/messages.ts            [MODIFY] booking subset only — add picker labels (bn/en)
components/booking/
  LocationPicker.tsx          [NEW] card/grid picker
  BookingWizard.tsx           [MODIFY] payload + draft v4
  steps/StepContactArea.tsx   [MODIFY] replace LocationSelectorFields with LocationPicker
  steps/StepQuickStart.tsx    [no change — legacy, untouched]
components/landing/
  LocationSelectorFields.tsx  [no change — still used by pre-reg + locator]
  PreRegisterSection.tsx      [no change]
  CampaignLocatorSection.tsx  [no change]
  CampaignScheduleSection.tsx [no change]
```

### 11.3 `bpa_web` (admin)

```
app/admin/(larkon)/campaigns/[id]/
  locations/page.tsx          [no change required for L1–L4]
  bookings/page.tsx           [no change required — already shows location.name]
                              [optional in L5: zone assignment UI]
```

---

## 12. Verification checklist (pre/post-deploy)

### 12.1 Pre-deploy (staging)

- [ ] `GET /api/v1/campaign/public/campaigns/:slug/locations` returns expected payload
- [ ] All campaign locations resolve `remainingCapacity` (region or slot fallback)
- [ ] All campaign locations resolve `bookingCount` (excluding `CANCELLED`)
- [ ] Inactive locations excluded with `available=true`
- [ ] `POST /checkout/init` with `locationId` succeeds (free + paid campaigns)
- [ ] `POST /checkout/init` with `area` only still succeeds (back-compat)
- [ ] `POST /checkout/init` with both fields → `locationId` wins
- [ ] `POST /checkout/init` with neither → 400 `LOCATION_REQUIRED`
- [ ] Fulfillment from old `area` session still creates booking (gradual migration)
- [ ] Fulfillment from new `locationId` session creates booking with correct slot
- [ ] `CampaignBooking.locationId` matches user selection
- [ ] `CampaignBooking.ownerAddressJson` contains `fullAddress` + `locationName`
- [ ] Slot `bookedCount` increments
- [ ] Region `bookedCount` increments when region is linked; skipped when null
- [ ] `BOOKING_CONFIRMED` SMS includes booking ref + verification code
- [ ] `/book/success?checkoutId=` poll returns booking with `location.name`
- [ ] Public picker on mobile (375 px) renders cards correctly with touch targets ≥44 px
- [ ] Bangla + English labels render
- [ ] Pre-registration form still uses Div/Dist/Upz cascading dropdowns
- [ ] Locator search (`/discovery/locator`) unaffected

### 12.2 Post-deploy (production)

- [ ] No spike in `CHECKOUT_VALIDATION_FAILED` audit rows
- [ ] Funnel metric: `booking_funnel_step: contact` → `checkout_initiated` conversion ≥ pre-deploy baseline
- [ ] Region `bookedCount` reconciliation (nightly script) shows no drift
- [ ] Admin bookings table renders new bookings without "unknown location"
- [ ] Hero / trust copy in landing — verify no orphan references to old "Select your area" wording
- [ ] Stale-doc banner remains on `PREMIUM-NATIONAL-CAMPAIGN-EXPERIENCE.md` (see master plan)

---

## 13. Decision log (open product questions)

| # | Question | Default proposed |
|---|----------|------------------|
| 1 | Show locations grouped by Coverage Zone in v1? | **No** — flat list in L1–L4; grouping in L5 |
| 2 | Allow operator to mark a location as "Featured" for top-of-list? | **Yes** — reuse `CampaignLocation.code` ordering or add `sortOrder` field (additive) |
| 3 | If a chosen location has no future slot, show next available date inline? | **Yes** — `nextSlotDate` already in payload |
| 4 | Allow user to filter picker by city/area text? | **Yes** — client-side filter on `address` + `addressJson.area` |
| 5 | Should pre-registration also adopt location selection? | **No** — pre-reg is for **inactive** areas where no location exists yet |
| 6 | What happens for paid bookings if the chosen location fills between init and webhook? | **Auto-retry** assignment to nearest active location? Or **fail fulfillment** and refund? Recommend **fail + refund** (matches express semantics today) |
| 7 | Persist `locationId` in pre-reg → booking conversion? | **Yes** — when admin notifies pre-reg users, the SMS could deep-link `/book?locationId=` |
| 8 | Rename misleading `getBookingsByCoverageZone` analytics function? | **Yes** — rename to `getBookingsByRolloutRegion`, add alias for back-compat |

---

## 14. Cross-references

- `docs/campaign-redesign/master-plan.md` — overall campaign redesign (this migration is a slice of master-plan R4 + R5)
- `docs/BPA_STANDARD.md` — non-deletion, update-only, additive-migration rules
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` — schema migration policy
- `docs/vaccination-campaign-2026/booking-flow-simplification-plan.md` — origin of the 3-step express flow (this migration is the next iteration)
- `docs/vaccination-campaign-2026/CAMPAIGN-LOCATOR.md` — locator continues to use Div/Dist/Upz
- `docs/vaccination-campaign-2026/NATIONAL-ROLLOUT-SYSTEM.md` — rollout regions remain the capacity backbone

---

*Document version: 1.0 — June 4, 2026. Planning only; no code modified.*
