# Campaign Location Management UI — Implementation Report

**Date:** 2026-06-04  
**Scope:** Admin location create/edit (`bpa_web`) + coverage APIs & validation (`backend-api`)  
**Reference:** `location-booking-implementation-report.md`

---

## Summary

Campaign admins can manage vaccination sites through a **structured location editor** (no raw JSON). Each location maps to **CoverageZone** + **BdArea** via the existing location master, with server-side validation and analytics-ready `addressJson` persistence.

---

## Phase 1 — Location editor

| Field | UI control | Persisted |
|-------|------------|-----------|
| Location name | Text | `CampaignLocation.name` |
| Address | Text | `CampaignLocation.address` |
| Phone | Text | `CampaignLocation.contactPhone` |
| Daily capacity | Number | `CampaignLocation.dailyCapacity` |
| Coverage zone | Dropdown | `addressJson.coverageZoneId` |
| Booking area | Text (auto from BdArea) | `addressJson.bookingArea` |
| BdArea | Searchable select (zone-filtered) | `addressJson.bdAreaId` |
| Status | Active / Inactive | `CampaignLocation.isActive` |

**UI:** Modal `CampaignLocationEditor` — create & edit from `/admin/campaigns/[id]/locations`.

---

## Phase 2 — Smart selectors

| Selector | Source |
|----------|--------|
| Coverage zone | `GET /api/v1/campaign/admin/coverage-zones` — active Dhaka metro / `METRO` / `dhaka-*` slugs |
| BdArea | `GET /api/v1/campaign/admin/coverage-zones/:zoneId/bd-areas?q=` — searchable, max 100 per query |

Zones display names such as **North Zone**, **West Zone**, **Central Zone** (from `CoverageZone` seed), plus DNCC/DSCC city zones when seeded.

---

## Phase 3 — Auto mapping

| Trigger | Behaviour |
|---------|-----------|
| BdArea selected | Sets `bookingArea` to `nameEn`; server validates area ∈ zone and fills `coverageZoneId` if missing |
| Coverage zone selected | Loads BdAreas for zone; **Suggested** chips (first 8 areas) for quick pick |
| Server `normalizeLocationCoverageInput` | Resolves zone from `bdAreaId` via `coverage_zone_areas`; rejects unmapped pairs |

---

## Phase 4 — Validation

| Rule | Layer | Error code |
|------|-------|------------|
| Duplicate name (same campaign, case-insensitive) | API | `LOCATION_DUPLICATE_NAME` (409) |
| BdArea not in selected zone | API | `LOCATION_INVALID_AREA_MAPPING` (400) |
| No zone and no resolvable BdArea | API | `LOCATION_MISSING_COVERAGE` (400) |
| Create without coverage payload | API | `LOCATION_MISSING_COVERAGE` |
| Client: name, zone/area, capacity | UI | Inline alert |

**Duplicate risk assessment**

| Risk | Mitigation |
|------|------------|
| Same display name twice on one campaign | Blocked by `assertUniqueCampaignLocationName` |
| Same physical site, different names | Allowed (ops choice); analytics aggregate by `locationId` |
| Same BdArea on multiple locations | Allowed; bookings still attribute to distinct `locationId` |
| Wrong zone/area combo | Blocked by `coverage_zone_areas` check |
| Legacy rows without `addressJson` | List still works; edit flow backfills mapping; public booking resolves zone from partial `addressJson` |

No duplicate location **system** — reuses `CampaignLocation`, `CoverageZone`, `BdArea` only.

---

## Phase 5 — Analytics readiness

Unchanged analytics services; they depend on booking `coverageZoneId` / `bookingArea` and location `addressJson` set at checkout.

| Report | Still works when locations mapped |
|--------|-----------------------------------|
| Bookings by location | Yes (`locationId`) |
| Cats by location | Yes (`petCount` by location) |
| Revenue by location | Yes (`paidAmount` sum) |
| Bookings by coverage zone | Yes (`coverageZoneId` on bookings after checkout) |
| Revenue by zone | Yes (zone grouping includes `totalRevenue`) |

---

## Files changed

### backend-api

| File | Change |
|------|--------|
| `src/api/v1/modules/campaign/coverageAdmin.service.ts` | **New** — zones, areas by zone, validation helpers |
| `src/api/v1/modules/campaign/coverageLocation.service.ts` | Export `resolveZoneIdFromBdArea` |
| `src/api/v1/modules/campaign/location.service.ts` | Enriched list; create/update validation & `addressJson` merge |
| `src/api/v1/modules/campaign/campaign.routes.ts` | Admin coverage-zone + bd-areas routes |
| `src/api/v1/modules/campaign/campaign.errors.ts` | Duplicate / mapping errors |

### bpa_web

| File | Change |
|------|--------|
| `src/bpa/campaign/admin/CampaignLocationEditor.tsx` | **New** — modal form |
| `app/admin/(larkon)/campaigns/[id]/locations/page.tsx` | Table + editor; zone/area columns |
| `lib/campaignApi.ts` | Types + `campaignAdminCoverageZones`, `campaignAdminBdAreasByZone` |

---

## Validation results

| Check | Result |
|-------|--------|
| `backend-api` `tsc --noEmit` | Pass |
| Editor lint (`CampaignLocationEditor`, locations page) | No issues |
| Manual QA | Recommended: create location → express book → Operations Center analytics |

---

## API quick reference

```http
GET  /api/v1/campaign/admin/coverage-zones
GET  /api/v1/campaign/admin/coverage-zones/:zoneId/bd-areas?q=Mirpur
GET  /api/v1/campaign/admin/campaigns/:campaignId/locations?includeInactive=true
POST /api/v1/campaign/admin/locations
PATCH /api/v1/campaign/admin/locations/:id
```

Create/update body includes `addressJson: { coverageZoneId, bdAreaId, bookingArea }` (set by UI; not hand-edited).

---

## Related

- `docs/campaign-v2/location-booking-implementation-report.md`
- `docs/dhaka-metro-coverage/README.md`
