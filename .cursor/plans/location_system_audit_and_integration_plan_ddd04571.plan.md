---
name: Location System Audit and Integration Plan
overview: "Scan both repos for all location-related usage, then produce two documents: LOCATION_AUDIT.md (inventory and analysis) and INTEGRATION_PLAN.md (future-proof integration plan). No code changes until approval."
todos: []
isProject: false
---

# Location System Audit and Integration Plan

## Scope

- **backend-api** (D:\BPA_Data\backend-api): API on port 3000, `/api/v1`
- **bpa_web** (D:\BPA_Data\bpa_web): Next.js ports 3100–3105
- **Rules**: No deletions; merge/add only. No port or script changes. Analysis and documentation first; no code until approved.

---

## 1. Deliverables


| Document         | Path                                                                                           | Purpose                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Location audit   | [docs/location/LOCATION_AUDIT.md](D:\BPA_Data\backend-api\docs\location\LOCATION_AUDIT.md)     | Full inventory of location-related code, APIs, data models, and touch points                                         |
| Integration plan | [docs/location/INTEGRATION_PLAN.md](D:\BPA_Data\backend-api\docs\location\INTEGRATION_PLAN.md) | Plan to integrate lat/lng-as-ground-truth, optional admin hierarchy, service areas, country policy, universal picker |


**Note:** `docs/location/` will live under **backend-api** as the single source for API+web location design; bpa_web can reference it. If you prefer both repos to have a copy, the plan can add a step to sync or duplicate into bpa_web/docs/location/.

---

## 2. LOCATION_AUDIT.md – Content Outline

Based on the repo scan, the audit will include:

### 2.1 Backend API – Location Usage

**Data models (Prisma)**

- **Geo / admin hierarchy**
  - `BdDivision`, `BdDistrict`, `BdUpazila`, `BdArea` – BD hierarchy; `latitude`/`longitude` (Decimal) on BdDistrict, BdUpazila, BdArea
  - `CityCorporation`, `Area` – Dhaka tree; `latitude`/`longitude` on Area
  - `Country`, `State` – global; used for policy and RBAC (no coordinates)
- **Entity location storage**
  - `Organization`: `countryId`, `addressJson` (no lat/lng columns)
  - `Branch`: `addressJson` only (no lat/lng on Branch itself)
  - `BranchProfileDetails`: `addressJson`, `latitude`, `longitude`, `coveragePolygon` (GeoJSON, Phase 3)
  - `FundraisingAccount` (schema 30_fundraising): `areaId`/bdArea, plus `countryCode`, `latitude`, `longitude`, `formattedAddress`, etc.

**Location module** ([src/api/v1/modules/locations/](D:\BPA_Data\backend-api\src\api\v1\modules\locations))

- **Routes** ([locations.routes.ts](D:\BPA_Data\backend-api\src\api\v1\modules\locations\locations.routes.ts)): `GET /countries`, `city-corporations`, `areas`, `divisions`, `districts`, `upazilas`, `bd-areas`, `search`, `resolve`, `geocode` (GET/POST), `reverse` (GET), `reverse-geocode` (POST)
- **Controller**: list/country/division/district/upazila/bd-area/area, searchLocations, resolveLocation, geocode (Nominatim), reverseGeocode; in-memory + optional Redis geocode cache
- **locationMatcher.service**: `matchCoordinatesToLocation(prisma, lat, lng, maxDistance)` – Haversine match to BdArea / Area (Dhaka); returns kind, ids, fullPathText, confidence

**Other backend touch points**

- **Owner** ([owner.controller.ts](D:\BPA_Data\backend-api\src\api\v1\modules\owner\owner.controller.ts)): org/branch create/update merge location into `addressJson` (kind, bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId, fullPathText, countryCode, etc.). Branch profile update does **not** currently pass `latitude`, `longitude`, or `coveragePolygon` to `upsertBranchProfileDetails` (schema supports them; API gap).
- **Pricing / Inventory**: “location” = `InventoryLocation` (branch-scoped), not geo; [pricing.service](D:\BPA_Data\backend-api\src\api\v1\modules\pricing\pricing.service.ts), [inventory](D:\BPA_Data\backend-api\src\api\v1\modules\inventory\inventory.controller.ts) use `locationId` = inventory location ID.
- **Country context** ([countryContext.ts](D:\BPA_Data\backend-api\src\middlewares\countryContext.ts)): sets `req.countryContext` (countryCode, policy, optional state); used for policy and RBAC.
- **Policy**: [policyEngine.service](D:\BPA_Data\backend-api\src\api\v1\services\policyEngine.service.ts) – country/state policies (no location geometry).

**Legacy**

- [src/modules/location/location.routes.ts](D:\BPA_Data\backend-api\src\modules\location\location.routes.ts) – `/dropdown`, `/hierarchy`, `/admin/sync` (separate from v1 locations; confirm if still mounted).

**Docs**

- [LOCATION_MODULE_SPEC.md](D:\BPA_Data\backend-api\docs\LOCATION_MODULE_SPEC.md), [GLOBAL_READY_FULL_PLANNING.md](D:\BPA_Data\backend-api\docs\GLOBAL_READY_FULL_PLANNING.md), [GLOBAL_READY_PHASE3_PREP.md](D:\BPA_Data\backend-api\docs\GLOBAL_READY_PHASE3_PREP.md), [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](D:\BPA_Data\backend-api\docs\GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) – reference Branch lat/lng, coverage_polygon, geocode, map picker.

### 2.2 bpa_web – Location Usage

**API calls to backend**

- `/api/v1/locations/divisions`, `districts`, `upazilas`, `bd-areas`, `city-corporations`, `areas`, `geocode`, `reverse`, `reverse-geocode`, `search`, `resolve`, `countries`

**Components** ([app/owner/_components/location/](D:\BPA_Data\bpa_web\app\owner_components\location))


| Component                     | Role                                                       | API used                                                                             |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| EnhancedLocationDropdown      | Single searchable dropdown; BD hierarchy + Dhaka + geocode | divisions, districts, upazilas, bd-areas, city-corporations, areas, geocode, resolve |
| ImprovedLocationPicker        | Tabs: Enhanced dropdown + CoordinateInput                  | + countries, reverse-geocode                                                         |
| UnifiedLocationPicker         | Mode switch: UnifiedEnhanced vs Dhaka + LocationSelector   | dynamic imports                                                                      |
| UnifiedEnhancedLocationPicker | Map + Enhanced dropdown with sync                          | reverse-geocode                                                                      |
| MapLocationPicker             | Leaflet map, search, drag marker                           | geocode, reverse-geocode                                                             |
| CoordinateInput               | Lat/lng inputs + reverse-geocode                           | reverse-geocode                                                                      |
| DhakaCityAreaDropdown         | City corp → areas                                          | city-corporations, areas                                                             |
| DhakaAreaPicker               | Dhaka area search                                          | city-corporations, areas                                                             |
| LocationSelector              | Division → District → Upazila → BdArea                     | divisions, districts, upazilas, bd-areas                                             |
| NationalLocationPicker        | Search-only                                                | search                                                                               |
| LocationBreakdown             | Display only                                               | -                                                                                    |


**Usage**

- Organization: new ([organizations/new/page.jsx](D:\BPA_Data\bpa_web\app\owner\organizations\new\page.jsx)), edit ([organizations/[id]/edit/page.jsx](D:\BPA_Data\bpa_web\app\owner\organizations[id]\edit\page.jsx)), registration ([organizations/[id]/registration/page.jsx](D:\BPA_Data\bpa_web\app\owner\organizations[id]\registration\page.jsx))
- Branch: [BranchForm.jsx](D:\BPA_Data\bpa_web\app\owner_components\branch\BranchForm.jsx)
- Owner profile: [profile/page.jsx](D:\BPA_Data\bpa_web\app\owner\profile\page.jsx)
- Products: [products/[id]/locations/page.tsx](D:\BPA_Data\bpa_web\app\owner\products[id]\locations\page.tsx) – “locations” = branches/inventory locations, not geo

**Other**

- [lib/locations.ts](D:\BPA_Data\bpa_web\src\lib\locations.ts) – demo static data (divisions/districts/upazilas), not used by API
- [lib/countryContext.ts](D:\BPA_Data\bpa_web\lib\countryContext.ts) – getCountryCode/setCountryCode, getStateCode/setStateCode (localStorage, subdomain)
- [SETUP_LOCATION_SYSTEM.md](D:\BPA_Data\bpa_web\SETUP_LOCATION_SYSTEM.md) – setup for map + geocode + enhanced picker

### 2.3 Gaps and Consistency Notes for Audit

- **BranchProfileDetails**: Schema has `latitude`, `longitude`, `coveragePolygon`; owner API does not read/write them in branch profile update (only addressJson, branchPhone, etc.).
- **No “Place” or universal location type**: Today “location” is either (1) BD/Dhaka admin hierarchy + optional GLOBAL_PLACE from geocode, or (2) InventoryLocation (branch).
- **Service area**: Only `coveragePolygon` (GeoJSON) in schema; no radius field or “point-in-polygon”/“point-in-radius” API yet.
- **Country-level policy**: Exists (CountryPolicy, StatePolicy, countryContext); not yet tied to location/geo rules (e.g. “only serve within country X”).

---

## 3. INTEGRATION_PLAN.md – Content Outline

The integration plan will align with the stated goal and strict rules:

**Goal**

- Lat/lng as ground truth (Place)
- Optional admin hierarchy (country/state/city, etc.)
- Service areas (radius first, polygon-ready)
- Country-level policy control
- Universal location picker (search + map pin)

**Sections to include**

1. **Principles**
  - Place = lat/lng (+ optional address/hierarchy); no deletion of existing hierarchy or addressJson; add only.
  - Backend stays port 3000; Next.js ports 3100–3105 unchanged.
2. **Data model (additive)**
  - Introduce a **Place** (or equivalent) notion: canonical lat/lng + optional countryId/stateId/city/address snapshot.
  - Keep BdDivision/BdDistrict/BdUpazila/BdArea, CityCorporation/Area; link or derive Place from them where applicable.
  - BranchProfileDetails: already has latitude/longitude/coveragePolygon; add API support to read/write them; add optional **coverageRadius** (km) for “radius first”; keep coveragePolygon for “polygon-ready”.
  - Organization/Branch: keep addressJson; optionally add Place reference or lat/lng where useful (no breaking change).
3. **Service area**
  - Radius-first: store coverageRadius (km) on BranchProfileDetails (or similar); API “is point in service area” using distance from branch lat/lng.
  - Polygon-ready: use existing coveragePolygon; add validation and optional “point-in-polygon” helper when needed.
4. **Country-level policy**
  - Keep countryContext and CountryPolicy/StatePolicy; document how location (country/state from Place or address) feeds into policy (e.g. feature flags, allowed countries for service).
5. **Universal location picker**
  - Single UX: search (geocode) + map pin; output = Place (lat/lng + optional hierarchy/address).
  - Backend: keep existing geocode/reverse endpoints; add optional “place” response shape (lat, lng, countryCode, state?, city?, formattedAddress) for consistency.
  - Frontend: consolidate toward one picker (e.g. UnifiedEnhancedLocationPicker + EnhancedLocationDropdown) that returns a single structure (lat/lng + optional BD/Dhaka/global breakdown); no removal of existing components until replaced by usage.
6. **Phased steps (high level)**
  - Phase 1: Document current state (LOCATION_AUDIT.md); expose BranchProfileDetails lat/lng/coveragePolygon (and optional coverageRadius) in owner API; ensure picker can write lat/lng to branch profile.
  - Phase 2: Introduce Place type (or normalized payload); add coverageRadius and “point in service area” (radius); optional polygon check.
  - Phase 3: Policy + location (e.g. country/state from Place used in policy checks); universal picker as default where applicable.
7. **Touch points (no code yet)**
  - Backend: locations module, owner.controller (branch profile), locationMatcher.service, policyEngine/countryContext.
  - Frontend: app/owner/_components/location/*, BranchForm, organization and registration pages, owner profile.
  - Docs: LOCATION_MODULE_SPEC, GLOBAL_READY_*.

---

## 4. Implementation Steps (After Approval)

1. **Create directory**
  - Ensure [backend-api/docs/location/](D:\BPA_Data\backend-api\docs\location) exists.
2. **Write LOCATION_AUDIT.md**
  - Use sections 2.1–2.3 above; list every file and endpoint found; note schema fields and API gaps (e.g. BranchProfileDetails lat/lng/coverage not in owner profile API).
3. **Write INTEGRATION_PLAN.md**
  - Use section 3 outline; keep plan additive and port-safe; reference LOCATION_AUDIT for touch points.
4. **Optional**
  - Add a short “Location system” entry in [backend-api/docs/REPO_MAP.md](D:\BPA_Data\backend-api\docs\REPO_MAP.md) or main docs index pointing to docs/location/.
  - If bpa_web should hold a copy, add docs/location/ there and copy or link the two files.
5. **Stop**
  - No code or schema changes until you approve. Next step after approval: implement Phase 1 (expose BranchProfileDetails lat/lng/coverage in API + wire picker) per INTEGRATION_PLAN.

---

## 5. Summary


| Item                 | Location                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Location API         | backend-api src/api/v1/modules/locations (routes, controller, locationMatcher.service)                                     |
| Geo models           | Prisma: BdDivision, BdDistrict, BdUpazila, BdArea, Area, CityCorporation; Country, State                                   |
| Entity location      | Organization (addressJson), Branch (addressJson), BranchProfileDetails (addressJson, latitude, longitude, coveragePolygon) |
| Picker components    | bpa_web app/owner/_components/location/* (11 components)                                                                   |
| Owner API gap        | Branch profile update does not send latitude, longitude, coveragePolygon to BranchProfileDetails                           |
| Inventory “location” | InventoryLocation (branch) / LocationPrice – not geo                                                                       |


The two documents will be written under **backend-api/docs/location/** as the single source of truth for the location system audit and integration plan.