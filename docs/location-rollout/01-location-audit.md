# Location Usage Audit

**Scope:** `backend-api`, `bpa_web`, `bpa_app`  
**Date:** 2026-06-03  
**Mode:** Read-only inventory (no code changes)

---

## Executive summary

BPA has **three parallel geo/address stacks** on the backend and **two client picker generations** on web and Flutter.

| Layer | Canonical (target) | Legacy / parallel |
|-------|-------------------|-------------------|
| BD hierarchy reads | `/api/v1/location-master/*` | `/api/v1/common/bd/*`, `/api/v1/locations/*` (now mostly delegates to location-master service) |
| Non-BD dropdowns | `/api/v1/geo/*` (static) | `lib/location/countries.ts`, `lib/countries.ts` |
| User GPS / manual place | `/api/v1/me/location/*` (`LocationPlace`) | `addressJson` blobs on org/branch/KYC |
| Dhaka metro tree | `/api/v1/locations/city-corporations`, `/areas` | Unmounted `locationDhaka.routes.ts`, Flutter `dhakaLocationsProvider` → missing `/locations/dhaka` |
| Stock “location” | `/api/v1/inventory/locations` | Unrelated to BD geo (warehouse nodes) |

**Web (active):** `LocationField` → `LocationPickerUnified` → `components/location/LocationSelector` → `location-master` client.  
**Flutter (active):** `LocationSelectorWidget` → `LocationRepository` → `location-master`.  
**Flutter (orphan):** `BdLocationsRepository` + `bd_*` providers + `DhakaCityDropdowns` — no screen imports found.

---

## Classification legend

| Status | Meaning |
|--------|---------|
| **ACTIVE** | Referenced by live UI or write paths today |
| **DEPRECATED** | Superseded; comments/files say not for new work |
| **DUPLICATE** | Same responsibility implemented twice |
| **SAFE_TO_REPLACE** | Unused or thin delegate; swap with low blast radius |
| **REQUIRES_MIGRATION** | Still used; wrong API, schema, or dual-write risk |

---

## 1. Backend (`D:\BPA_Data\backend-api`)

### 1.1 API surfaces

| Finding | Path / module | Status | Notes |
|---------|---------------|--------|-------|
| Location master (canonical) | `src/modules/location/` → `/api/v1/location-master` | **ACTIVE** | `divisions`, `districts`, `upazilas`, `unions`, `areas`, `search`, `validate-selection`, coverage |
| Legacy locations router | `src/api/v1/modules/locations/` → `/api/v1/locations` | **DUPLICATE** | Hierarchy handlers **delegate** to `modules/location/location.service`; also Dhaka corp/area, geocode, search, nearby |
| Common BD (Flutter legacy) | `common.controller` → `/api/v1/common/bd/*` | **DEPRECATED** | Direct Prisma on `bdDivision` / `bdDistrict` / `bdUpazila` / `bdArea`; response shape `{ items }` vs master `{ data }` |
| Geo static | `src/api/v1/modules/geo/` → `/api/v1/geo` | **ACTIVE** | `geo.data.ts` hardcoded countries/states/cities; Nominatim proxy for search/reverse |
| Me location profile | `src/api/v1/modules/me/location.*` | **ACTIVE** | `LocationPlace`, events, manual set — parallel to relational BD IDs |
| Campaign rollout geo | `/api/v1/campaign/public/rollout/divisions|districts|upazilas` | **ACTIVE** | Separate read helpers (`listBdDivisions` etc.), not location-master HTTP |
| Campaign site locations | `campaign/location.service.ts` | **ACTIVE** | `CampaignLocation` CRUD — **not** BD master (vaccination sites) |
| Inventory locations | `/api/v1/inventory/locations`, `/owner/inventory/locations` | **ACTIVE** | Warehouse/stock nodes — **not** address hierarchy |
| Dhaka route file | `src/api/v1/routes/locationDhaka.routes.ts` | **DEPRECATED** | **Not mounted** in `routes.ts`; dead entry |
| Dhaka service | `src/api/v1/services/locationDhaka.service.ts` | **DEPRECATED** | Only referenced by unmounted routes |
| Legacy locations.service | `src/api/v1/modules/locations/locations.service.ts` | **DUPLICATE** | `getDhakaLocations`, older list helpers; partially superseded by controller → location.service |
| Owner location validation | `owner/utils/locationValidation.js` | **REQUIRES_MIGRATION** | JS util parallel to `validateSelection` |

**Write paths using centralized `validateSelection`:** `partner_onboarding.controller`, `organizations.controller`, `owner.controller`, `producer.service`, `doctorVerification.service`, `meProfile.service`.

**Gaps (from `docs/location-system-migration/module-validation-report.md`):** `profile.controller` / registration do not persist `divisionId`…`unionId`; fundraising partial union support.

### 1.2 Duplicate backend services / repositories

| Layer A | Layer B | Status |
|---------|---------|--------|
| `src/modules/location/location.repository.ts` | `src/api/v1/modules/locations/locations.service.ts` | **DUPLICATE** |
| `src/modules/location/location.service.ts` | `common.controller` BD getters | **DUPLICATE** (same tables, different contracts) |
| `src/api/v1/modules/me/location.service.ts` | `modules/location` | **DUPLICATE** (user place vs admin hierarchy) |
| `src/api/v1/modules/campaign/location.service.ts` | `modules/location` | **ACTIVE** (different domain: campaign sites) |

### 1.3 Hardcoded / static backend data

| Finding | Location | Status |
|---------|----------|--------|
| Geo countries/states/cities | `src/api/v1/modules/geo/geo.data.ts` | **ACTIVE** |
| Dhaka district constant `DIS-47` | `locations.service.ts`, seeds | **ACTIVE** (Dhaka-only logic) |
| Seed JSON / scripts | `prisma/seeders/seedBaseBdLocations.ts`, `seedLocationsDhaka.js`, `prisma/seeders/dhaka/*` | **ACTIVE** (data pipeline, not runtime API) |

### 1.4 Old location APIs (compatibility matrix)

| Endpoint prefix | Consumers | Status |
|-----------------|-----------|--------|
| `/api/v1/location-master` | Web `locationMasterClient`, Flutter `LocationRepository`, e2e `location-master-api.spec.ts` | **ACTIVE** |
| `/api/v1/locations/divisions`…`bd-areas` | `BdHierarchyPicker`, `LocationPicker.jsx` (if ever mounted) | **DEPRECATED** clients; API now proxies master service |
| `/api/v1/common/bd/*` | Flutter `BdLocationsRepository` (orphan) | **DEPRECATED** |
| `/api/v1/geo/*` | `LocationPickerUnified` (non-BD), `components/location/LocationPicker.tsx` | **ACTIVE** |
| `/api/v1/campaign/public/rollout/*` | Admin rollout UI `campaignApi.ts` | **ACTIVE** |
| `/api/v1/locations/city-corporations`, `/areas` | `DhakaAreaPicker.jsx`, `DhakaCityAreaDropdown.jsx` | **DEPRECATED** UI files (unreferenced from `app/`) |
| `/api/v1/locations/dhaka` | Flutter `dhakaLocationsProvider` | **REQUIRES_MIGRATION** — endpoint **not defined** in routes (404 risk) |

---

## 2. Web (`D:\BPA_Data\bpa_web`)

### 2.1 Canonical picker chain (ACTIVE)

```
LocationField (src/components/location/LocationField.tsx)
  → LocationPickerUnified (components/common/LocationPickerUnified.tsx)
      → BD: LocationSelector + Division/District/Upazila/UnionDropdown
            → locationMasterClient → /api/v1/location-master/*
      → non-BD: /api/v1/geo/countries|states + geo search/reverse
      → map: MapPickerUnified → MapPicker → /api/v1/locations/reverse (GET)
  → normalizeLocation / withLegacyLocationFields (src/lib/location/normalizeLocation.ts)
```

**Screens using `LocationField` (ACTIVE):**

- `app/owner/(larkon)/organizations/_components/OrganizationWizardForm.jsx`
- `app/owner/(larkon)/organizations/[id]/registration/page.jsx`
- `app/owner/(larkon)/organizations/[id]/edit/page.jsx`
- `app/owner/_components/branch/BranchForm.jsx`
- `app/owner/kyc/_components/KycAddressForm.tsx`
- `app/owner/(larkon)/profile/page.jsx`

### 2.2 Legacy location selectors

| Component | API / data source | Status |
|-----------|-------------------|--------|
| `components/LocationPicker.jsx` | `/api/v1/locations/divisions`…`bd-areas` | **DEPRECATED** — no `app/` imports found |
| `components/location/LocationPicker.tsx` | `/api/v1/geo/*`, static `lib/location/countries` | **DEPRECATED** — no `app/` imports found |
| `src/components/location/bd/BdHierarchyPicker.tsx` | `/api/v1/locations/*` | **DEPRECATED** — file marked `@deprecated`; unused |
| `app/owner/_components/location/LocationSelector.jsx` | Delegates to `LocationPickerUnified` | **SAFE_TO_REPLACE** |
| `ImprovedLocationPicker.jsx`, `EnhancedLocationDropdown.jsx`, `UnifiedLocationPicker.jsx` | Delegates to unified picker | **SAFE_TO_REPLACE** |

### 2.3 Legacy district / division dropdowns

| Component | Source | Status |
|-----------|--------|--------|
| `DivisionDropdown`, `DistrictDropdown`, `UpazilaDropdown`, `UnionDropdown` | `LocationMasterDropdown` → location-master | **ACTIVE** (via `LocationSelector`) |
| Admin campaign rollout `<select>` | `campaignPublicBdDivisions/Districts/Upazilas` | **ACTIVE** — **not** location-master |
| `src/lib/locations.ts` static arrays | Hardcoded 4 divisions, 6 districts, 7 upazilas | **DEPRECATED** — demo data, no imports |

### 2.4 Legacy Dhaka-only pickers

| Component | API | Status |
|-----------|-----|--------|
| `DhakaAreaPicker.jsx` | `/locations/city-corporations`, `/locations/areas` | **DEPRECATED** — not imported from `app/` |
| `DhakaCityAreaDropdown.jsx` | Same + `apiGet` | **DEPRECATED** — not imported from `app/` |
| `UnifiedEnhancedLocationPicker.jsx` | Map + legacy geocode/reverse-geocode POST | **DEPRECATED** — self-contained under `owner/_components/location/` |

### 2.5 Hardcoded / static web lists

| File | Content | Status |
|------|---------|--------|
| `lib/location/countries.ts` | Static ISO country list | **ACTIVE** (CountrySelect, LocationPicker.tsx) |
| `lib/countries.ts` | Duplicate country concept | **DUPLICATE** |
| `src/lib/locations.ts` | Fake BD division/district/upazila tree | **DEPRECATED** |
| `app/owner/kyc/_data/nationalities.ts` | Notes reuse of geo/countries | **ACTIVE** |

### 2.6 Old address components

| Component | Role | Status |
|-----------|------|--------|
| `normalizeLocation.ts` + `withLegacyLocationFields` | Maps `dhakaAreaId`, `bdAreaId`, `areaId`, coords | **ACTIVE** — backward compat for APIs |
| `lib/locationPlace.ts` | `POST /me/location/manual` adapter | **ACTIVE** (`organizations/new`) |
| `KycAddressForm` + `addressAdapter.ts` | KYC address → `LocationValue` | **ACTIVE** |
| `LocationBreakdown.jsx` | Display helper | **DEPRECATED** if unused (owner/_components) |

### 2.7 Duplicate Next.js hooks

| Hook | File | Status |
|------|------|--------|
| `useRecentLocations` | `src/components/location/hooks/useRecentLocations.ts` | **ACTIVE** — only location-specific hook; used by `LocationPickerUnified` |
| `useLocation` (react-router) | `src/helper/RouteScrollToTop.jsx` | **ACTIVE** — routing only, not geo |

No duplicate BD hierarchy hooks; cascade logic is inline in `LocationPickerUnified` + dropdown components.

### 2.8 Duplicate map pickers

| File | Status |
|------|--------|
| `src/components/location/MapPicker.tsx` | **ACTIVE** (unified flow) |
| `components/MapPicker.jsx` | **DUPLICATE** — used by legacy `LocationPicker.jsx` |
| `app/owner/_components/location/MapLocationPicker.jsx` | **DEPRECATED** |

### 2.9 Admin / campaign / inventory (context)

| Area | Location meaning | Status |
|------|------------------|--------|
| Campaign rollout admin | BD division/district/upazila via campaign API | **ACTIVE** — **REQUIRES_MIGRATION** to location-master for consistency |
| Inventory pages | `GET /api/v1/inventory/locations` | **ACTIVE** — warehouse IDs only |
| Owner onboarding steps | Text address fields only; no `LocationField` in `OrganizationStep` / `BranchStep` | **REQUIRES_MIGRATION** if hierarchy required at onboarding |
| Vendors | Free-text `district` / `city` fields | **REQUIRES_MIGRATION** |
| Account hub (`AccountHubPage`) | Profile API; no `LocationField` in component | **REQUIRES_MIGRATION** per backend profile gap |

### 2.10 Prior internal docs (reference only)

- `bpa_web/docs/location/LOCATION_AUDIT.md` (2025-02) — partially stale; BD removal doc claims no DB loads, but `LocationPickerUnified` now loads **location-master** for BD.
- `bpa_web/docs/location/LOCATION_BD_AUDIT_REMOVAL.md` — contradicts current `LocationSelector.tsx` implementation.

---

## 3. Flutter (`D:\BPA_Data\bpa_app`)

### 3.1 Canonical stack (ACTIVE)

| Piece | Path | API |
|-------|------|-----|
| `LocationRepository` | `lib/features/location/data/location_repository.dart` | `/api/v1/location-master/*` + cache |
| `location_provider.dart` | `locationDivisionsProvider`, `locationDistrictsProvider`, … | Wraps repository |
| `LocationSelectorWidget` | `lib/features/location/presentation/widgets/location_selector_widget.dart` | Used by fundraising create/edit/setup |
| `location_picker_screen.dart` | Full-screen picker | Used from `fundraising_account_setup_screen.dart` |
| `api_endpoints.dart` | `locationMaster*` helpers | **ACTIVE** |

### 3.2 Legacy / duplicate Flutter

| Piece | API | Status |
|-------|-----|--------|
| `BdLocationsRepository` | `/api/v1/common/bd/*` | **DUPLICATE** — **orphan** (providers never imported outside `bd_location_providers.dart`) |
| `bd_location_providers.dart` | `bdDivisionsProvider`, … | **DEPRECATED** |
| `dhaka_location_providers.dart` | `GET /api/v1/locations/dhaka?lang=` | **DEPRECATED** — route **missing** on backend |
| `DhakaCityDropdowns` | Uses `dhakaLocationsProvider` | **DEPRECATED** — **orphan** (no screen imports) |
| `bd_location_models.dart` | Shared models | **ACTIVE** (shared with location feature) |

### 3.3 Duplicate Flutter providers

| Modern | Legacy | Status |
|--------|--------|--------|
| `locationDivisionsProvider` | `bdDivisionsProvider` | **DUPLICATE** — migrate callers off `bd_*` then delete |
| `LocationRepository` | `BdLocationsRepository` | **DUPLICATE** |

### 3.4 Campaign / feed

- Campaign models reference `location` strings for display — not hierarchy pickers.
- `feed_post_card.dart` — location display only (grep hit); no picker.

---

## 4. Cross-cutting risks

1. **Dual response shapes:** `common/bd` returns `{ items }`; location-master returns `{ data, meta }`. Flutter legacy repo parses `items` only.
2. **Legacy field names in payloads:** `dhakaAreaId`, `areaId`, `bdAreaId` still emitted by `withLegacyLocationFields` for org/branch APIs.
3. **Three BD read paths for admin campaign:** campaign rollout endpoints vs location-master vs common/bd.
4. **Unmounted / broken endpoints:** `locationDhaka.routes`, Flutter `/locations/dhaka`.
5. **Inventory vs geo naming:** “location” in UI often means warehouse — document in reviews to avoid wrong migration.

---

## 5. Recommended target state (documentation only)

| Concern | Recommended source |
|---------|-------------------|
| BD hierarchy UI (web + Flutter) | `/api/v1/location-master` + `validate-selection` on writes |
| Non-BD country/state/city | `/api/v1/geo` |
| Dhaka metro fine-grained | `/api/v1/locations/city-corporations` + `/areas` **or** extend location-master `areas` with type filter |
| User device location | `/api/v1/me/location` |
| Campaign rollout admin reads | Align to location-master (or shared service), keep campaign-specific rollout **writes** |
| Remove | `common/bd/*` (after Flutter deletes `BdLocationsRepository`), unmounted `locationDhaka.routes`, static `src/lib/locations.ts`, unused web picker files |

---

## 6. File inventory quick reference

### Backend — location-related modules

- `src/modules/location/*` — canonical
- `src/api/v1/modules/locations/*` — legacy router + geocode + Dhaka tree
- `src/api/v1/modules/common/common.controller.ts` — `common/bd`
- `src/api/v1/modules/geo/*` — static international
- `src/api/v1/modules/me/location.*` — user place
- `src/api/v1/services/locationDhaka.service.ts` — unmounted
- `src/api/v1/modules/campaign/location.service.ts` — campaign sites

### Web — pickers

- **Active:** `LocationField`, `LocationPickerUnified`, `components/location/LocationSelector` + `*Dropdown.tsx`, `locationMasterClient.ts`, `normalizeLocation.ts`
- **Deprecated / unused in app:** `LocationPicker.jsx`, `components/location/LocationPicker.tsx`, `BdHierarchyPicker`, `app/owner/_components/location/*` (except as dead code)

### Flutter

- **Active:** `features/location/*`
- **Orphan legacy:** `features/common/.../bd_locations_repository.dart`, `bd_location_providers.dart`, `dhaka_*`

---

*Generated by static analysis and import tracing across the three application repositories. Re-run after major refactors or before deleting deprecated files.*
