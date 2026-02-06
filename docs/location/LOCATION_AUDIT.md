# Location Audit – Every Place Location Is Used

**Scope:** backend-api + bpa_web. No code changed; inventory only.  
**Date:** 2025-02-02.

---

## 1. DB Schema and Migrations

### 1.1 Prisma schema (backend-api)

**File:** `prisma/schema.prisma`

| Model / area | Location-related fields | Note |
|--------------|-------------------------|------|
| **OwnerKyc** | `divisionId`, `districtId`, `upazilaId`, `areaId` | Optional location pointers; full address in presentAddressJson. |
| **BranchProfileDetails** | `addressJson`, `latitude`, `longitude`, `googleMapLink`, `coveragePolygon` | Branch address + coords + Phase 3 GeoJSON coverage. |
| **FundraisingAccount** | `countryCode`, `divisionId`, `districtId`, `upazilaId`, `areaId` (bdArea), `countryName`, `stateName`, `cityName`, `addressLine`, `latitude`, `longitude`, `formattedAddress` | BD hierarchy + global/map fields (schema 30_fundraising). |
| **FundraisingCampaign** | `countryCode` | Country binding for campaigns. |
| **Organization** | `countryId`, `addressJson` | Org scope + address blob (no lat/lng columns). |
| **Branch** | `addressJson` | Address blob only; lat/lng on BranchProfileDetails. |
| **BdDivision** | (none) | Root of BD hierarchy. |
| **BdDistrict** | `divisionId`, `latitude`, `longitude` | Division link + optional center coords. |
| **BdUpazila** | `districtId`, `latitude`, `longitude` | District link + optional center coords. |
| **BdArea** | `upazilaId`, `districtId`, `parentId`, `latitude`, `longitude` | Union/area + Dhaka legacy; optional coords. |
| **CityCorporation** | (none) | Dhaka DNCC/DSCC etc. |
| **Area** | `cityCorporationId`, `parentId`, `latitude`, `longitude` | Dhaka tree; optional coords. |
| **Country** | `code`, `name`, etc. | Policy/scope; no coords. |
| **State** | `countryId`, `code`, `name` | Policy/scope; no coords. |
| **Ad** | `countryId` | Country targeting. |
| **ProducerOrg** | `countryId`, `addressJson` | Producer scope + address. |
| **AccessInvite** | `countryCode` | Country-scoped invite. |
| **UserCountryRole** | `countryId` | Country RBAC. |
| **UserStateRole** | (state) | State RBAC. |
| **InventoryLocation** | `branchId`, `type`, `name` | Branch-scoped “location” (stock), not geo. |
| **LocationPrice** | `locationId` (→ InventoryLocation) | Price per inventory location, not geo. |

**Other schema files**

- `prisma/schema/30_fundraising.prisma` – FundraisingAccount location fields (countryCode, lat/lng, etc.).
- `prisma/schema/40_location.prisma` – Likely BD/Dhaka location models (split schema).

### 1.2 Migrations (location-related)

**Path:** `prisma/schema_final_clean/migrations/` (reference migrations; main app may use different migration dir.)

| Migration | Location-related change |
|-----------|-------------------------|
| `20260104120000_bd_locations/migration.sql` | Creates bd_divisions, bd_districts, bd_upazilas, bd_areas. |
| `20260105101000_fundraising_account_bd_links/migration.sql` | Adds divisionId, districtId, upazilaId, areaId to fundraising_accounts. |
| `20260105225246_citycorporationarea/migration.sql` | Adds districtId, parentId to bd_areas; city corporation/area. |
| `20260111143315_clinic_shop_and_permission/migration.sql` | Adds addressJson to org/branch-related tables. |
| `20260115043330_owners_organization_data/migration.sql` | Adds addressJson, latitude, longitude to branch_profile_details. |

### 1.3 Location seed / reference data

| Path | Note |
|------|------|
| `prisma/seeders/seedBaseBdLocations.ts` | Seeds BD divisions/districts/upazilas/areas. |
| `prisma/seeders/seedCountries.ts` | Seeds countries. |
| `prisma/seeders/seedOrganizationCountries.ts` | Org–country links. |
| `prisma/seeders/seedLocationsDhaka.js` | Dhaka locations. |
| `prisma/seeders/seedCityCorporationsAndAreas.js` | City corporations + areas. |
| `prisma/seed-data/*.json` | bd.divisions, bd.districts, bd.upazilas, bd.areas, dhaka.areas. |
| `prisma/MIGRATION_LOCATION_COORDINATES.md` | Documents lat/lng migration. |

---

## 2. API Routes Handling Address or Location

### 2.1 Locations module (geo + hierarchy)

**Base path:** `/api/v1/locations`  
**File:** `src/api/v1/modules/locations/locations.routes.ts`

| Method + path | Handler | Note |
|---------------|---------|------|
| GET `/countries` | listCountries | List countries. |
| GET `/city-corporations` | listCityCorporations | Dhaka corps (DNCC/DSCC). |
| GET `/areas` | searchAreas | Areas by corp/parent. |
| GET `/divisions` | listDivisions | BD divisions. |
| GET `/districts` | listDistricts | BD districts. |
| GET `/upazilas` | listUpazilas | BD upazilas. |
| GET `/bd-areas` | listBdAreas | BD areas. |
| GET `/search` | searchLocations | Unified search (BD + Dhaka + optional geocode). |
| GET `/resolve` | resolveLocation | Resolve bdAreaId or dhakaAreaId to details + lat/lng. |
| GET `/geocode` | geocode | Forward geocode (query → Nominatim). |
| GET `/reverse` | reverseGeocode | Reverse geocode (lat, lng → address). |
| POST `/geocode` | geocode | Same, POST body. |
| POST `/reverse-geocode` | reverseGeocode | Same, POST body. |

**Controller:** `src/api/v1/modules/locations/locations.controller.ts`  
- List/country/division/district/upazila/bd-area/area; searchLocations; resolveLocation; geocode; reverseGeocode.  
- Uses Nominatim, in-memory + optional Redis cache, `locationMatcher.service` for coordinate→BD/Dhaka match.

**Service:** `src/api/v1/modules/locations/locationMatcher.service.ts`  
- `matchCoordinatesToLocation(prisma, lat, lng, maxDistance)` – Haversine match to BdArea or Area (Dhaka); returns kind, ids, fullPathText, confidence.

**Registration:** `src/api/v1/routes.ts` – `router.use("/locations", require("./modules/locations/locations.routes"))`.

### 2.2 Dhaka-only location routes (legacy/alt)

**File:** `src/api/v1/routes/locationDhaka.routes.ts`  
- GET `/city-corps` – dhakaCityCorps.  
- GET `/search` – dhakaSearch.  
- Uses `locationDhaka.service` (city-corps + search).  
- **Note:** Check if this router is mounted in `routes.ts`; main locations module also has city-corporations and search.

### 2.3 Owner API (org + branch address/location)

**File:** `src/api/v1/modules/owner/owner.controller.ts`

| Logic | Location usage |
|-------|----------------|
| Create organization | Merges addressJson (kind, bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, fullPathText, countryCode, etc.). |
| Update organization | Same; merges addressJson and optional location fields from body. |
| Create branch | addressJson with location snapshot. |
| Update branch | Merges addressJson (locationKind, bdAreaId, dhakaAreaId, divisionId, districtId, upazilaId, cityCorporationId, dhakaAreaId, etc.); validates BD_AREA / DHAKA_AREA refs. |
| Update branch profile | Upserts BranchProfileDetails with addressJson, branchPhone, branchEmail, managerName, managerPhone, googleMapLink. **Does not** pass latitude, longitude, or coveragePolygon (schema has them; API gap). |
| Submit branch profile | Requires addressJson (location/address) before submit. |

**File:** `src/api/v1/modules/owner/controllers/organizations.controller.ts`  
- addressJson in org update (Zod optional).

**File:** `src/api/v1/modules/owner/routes/organizations.routes.ts`  
- Update basic info (name, supportPhone, addressJson).

### 2.4 Other API modules (country/location in scope only)

- **Me / permissions:** `src/api/v1/modules/me/me.controller.ts` – uses `req.countryContext?.countryCode` and `state?.stateId` for effective permissions.  
- **Country/state policies:** `src/api/v1/modules/admin_country_policies/`, `admin_state_policies/`, `admin_countries/`, `admin_states/` – CRUD for Country/State and policies (no geo).  
- **Country/state staff & invites:** `admin_country_users`, `country_staff`, `country_access_invites`, `state_access_invites` – country/state scoping.  
- **Policy engine:** `src/api/v1/services/policyEngine.service.ts` – getActivePolicy(countryCode), getActiveStatePolicy(countryCode, stateCode).  
- **Country context middleware:** `src/middlewares/countryContext.ts` – sets req.countryContext (countryCode, policy, state).  
- **Fundraising:** `src/api/v1/modules/fundraising/fundraising.controller.ts` + `fundraising.service.ts` – FundraisingAccount has divisionId, districtId, upazilaId, areaId, countryCode, lat/lng (schema); used for account address.  
- **Pricing / Inventory:** `locationId` in pricing and inventory = **InventoryLocation** (branch stock location), not geo.  
  - `src/api/v1/modules/pricing/pricing.controller.ts`, `pricing.service.ts`, `pricing.routes.ts`  
  - `src/api/v1/modules/inventory/inventory.controller.ts`, `ledger.service.ts`, `inventory.routes.ts`  
- **Online-store:** `src/api/v1/modules/online-store/online-store.service.ts` – filters by location type (ONLINE_HUB); “location” = InventoryLocation.  
- **Branches (admin):** `src/api/v1/modules/admin_branches/admin_branches.controller.ts` – branch list/detail may expose addressJson.  
- **Partner onboarding:** `src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts` – org/branch creation; may pass address.  
- **Profile:** `src/api/v1/modules/profile/profile.controller.ts` – user profile may include addressJson.  
- **Common:** `src/api/v1/modules/common/common.controller.ts` + `common.routes.ts` – may expose countries or location dropdowns.

### 2.5 Legacy location module (non-v1)

**File:** `src/modules/location/location.routes.ts`  
- GET `/dropdown`, GET `/hierarchy`, POST `/admin/sync`.  
- **Note:** Separate from v1 locations; confirm whether still mounted in app.

---

## 3. UI Forms and Pages (bpa_web)

### 3.1 Location picker components

**Dir:** `app/owner/_components/location/`

| File | Role | APIs used |
|------|------|-----------|
| `EnhancedLocationDropdown.jsx` | Single searchable dropdown: BD hierarchy + Dhaka + geocode. | divisions, districts, upazilas, bd-areas, city-corporations, areas, geocode, resolve |
| `ImprovedLocationPicker.jsx` | Tabs: Enhanced dropdown + CoordinateInput. | + countries, reverse-geocode |
| `UnifiedLocationPicker.jsx` | Mode switch: UnifiedEnhanced vs Dhaka + LocationSelector. | dynamic imports of below |
| `UnifiedEnhancedLocationPicker.jsx` | Map + Enhanced dropdown with sync. | reverse-geocode |
| `MapLocationPicker.jsx` | Leaflet map, search, drag marker. | geocode, reverse-geocode |
| `CoordinateInput.jsx` | Lat/lng inputs + reverse-geocode button. | reverse-geocode |
| `DhakaCityAreaDropdown.jsx` | City corp → areas tree. | city-corporations, areas |
| `DhakaAreaPicker.jsx` | Dhaka area search. | city-corporations, areas |
| `LocationSelector.jsx` | Division → District → Upazila → BdArea cascade. | divisions, districts, upazilas, bd-areas |
| `NationalLocationPicker.jsx` | Search-only (unified search). | search |
| `LocationBreakdown.jsx` | Display-only location breakdown. | — |

### 3.2 Forms/pages that input or display location

| Path | Usage |
|------|--------|
| `app/owner/organizations/new/page.jsx` | ImprovedLocationPicker for org address. |
| `app/owner/organizations/[id]/edit/page.jsx` | ImprovedLocationPicker for org address. |
| `app/owner/organizations/[id]/registration/page.jsx` | UnifiedLocationPicker for business location. |
| `app/owner/_components/branch/BranchForm.jsx` | LocationSelector, DhakaCityAreaDropdown, ImprovedLocationPicker for branch address. |
| `app/owner/profile/page.jsx` | UnifiedLocationPicker for owner profile. |
| `app/owner/staffs/[id]/edit/page.jsx` | May show/edit address or location. |
| `app/owner/_components/organization/OrganizationDetailView.jsx` | Displays org details (may include address). |
| `app/owner/register/page.jsx` | Simple address text field (no picker). |
| `app/register/page.jsx` | Register form (may have address). |
| `app/owner/branches/[id]/page.jsx` | Branch detail (address/location display). |
| `app/owner/branches/[id]/settings/page.jsx` | Branch settings (may include profile/address). |
| `app/owner/organizations/[id]/branches/[branchId]/page.jsx` | Branch in org context. |
| `app/admin/branches/manager/page.jsx` | Admin branch management (location/address). |
| `app/admin/verifications/page.jsx` | Verifications (may show branch/address). |
| `app/admin/verifications/producer-orgs/[id]/page.jsx` | Producer org (address/country). |
| `app/producer/kyc/page.jsx` | Producer KYC (address). |

### 3.3 Pages that use “location” as inventory/branch (not geo)

| Path | Note |
|------|------|
| `app/owner/products/[id]/locations/page.tsx` | “Locations” = branches / inventory locations (locationId = InventoryLocation). |
| `app/owner/products/[id]/pricing/page.tsx` | Pricing per location (inventory location). |
| `app/owner/products/[id]/page.tsx` | Link to product locations (inventory). |
| `app/owner/transfers/page.tsx` | Transfers between locations (inventory). |
| `app/owner/dashboard/page.jsx` | Dashboard (may show branch/list context). |
| `app/admin/pricing/page.jsx` | Admin pricing (locationId). |

### 3.4 Other UI (country/location context)

| Path | Note |
|------|------|
| `lib/countryContext.ts` | getCountryCode/setCountryCode, getStateCode/setStateCode (localStorage, subdomain). |
| `lib/usePolicyFeatures.ts` | Policy features (country-related). |
| `src/components/MapPicker.tsx` | Generic map picker; calls `/api/v1/locations/reverse`. |
| `src/lib/locations.ts` | Static demo data (divisions/districts/upazilas); not used by locations API. |

---

## 4. Logic Depending on Location

### 4.1 Delivery / branch filter / nearby

- **BranchProfileDetails:** Schema has `latitude`, `longitude`, `coveragePolygon` for future “branch coverage” / delivery zone. No API or UI yet that filters branches by lat/lng or “point in polygon.”  
- **Location matcher:** `locationMatcher.service.ts` – coordinates → nearest BdArea or Area (Dhaka) within maxDistance (e.g. 10 km); used by reverse-geocode response to attach matched BD/Dhaka location.  
- **Online-store:** Filters stock by `InventoryLocation.type = ONLINE_HUB` (branch-level, not geo “nearby”).

### 4.2 Country rules and policy

- **Country context:** `src/middlewares/countryContext.ts` – resolves country (header → user country role → org country → default BD); sets req.countryContext (countryCode, policy, optional state).  
- **Policy engine:** `src/api/v1/services/policyEngine.service.ts` – getActivePolicy(countryCode), getActiveStatePolicy(countryCode, stateCode); used for features, payment methods, etc.  
- **Permissions:** `src/api/v1/services/permissions.service.ts` – getEffectivePermissions(userId, countryCode, stateId); country/state roles.  
- **Me controller:** Effective permissions use req.countryContext.countryCode and state.stateId.  
- **Feature guard:** `requireFeature` / policyGuard – policy-driven feature flags by country.  
- **Fundraising / wallet / ads:** Use countryId or countryCode for scoping and policy (e.g. campaign country, ad country).

### 4.3 Validation and business rules

- **Owner controller:** Validates bdAreaId, divisionId, districtId, upazilaId, dhakaAreaId, cityCorporationId when updating branch/org addressJson; ensures area belongs to city corp when both provided.  
- **Branch profile submit:** Requires addressJson (location/address) before KYC submit.

---

## 5. Gaps and Notes

- **BranchProfileDetails:** Schema has `latitude`, `longitude`, `coveragePolygon`; owner branch-profile update does **not** send them (only addressJson, phone, email, manager, googleMapLink).  
- **Service area:** Only `coveragePolygon` in schema; no `coverageRadius` or “point in service area” API.  
- **Place type:** No single “Place” (lat/lng + optional hierarchy) type; location is either BD/Dhaka hierarchy + optional GLOBAL_PLACE from geocode, or InventoryLocation (branch).  
- **Products “locations”:** In product and pricing UIs, “location” = InventoryLocation (branch/warehouse), not geographic location.

---

## 6. Quick Reference – File Paths

**Backend (backend-api)**  
- Schema: `prisma/schema.prisma`, `prisma/schema/30_fundraising.prisma`, `prisma/schema/40_location.prisma`  
- Locations API: `src/api/v1/modules/locations/locations.routes.ts`, `locations.controller.ts`, `locationMatcher.service.ts`  
- Dhaka routes: `src/api/v1/routes/locationDhaka.routes.ts`  
- Owner: `src/api/v1/modules/owner/owner.controller.ts`  
- Country context: `src/middlewares/countryContext.ts`  
- Policy: `src/api/v1/services/policyEngine.service.ts`  
- Permissions: `src/api/v1/services/permissions.service.ts`  
- Seed: `prisma/seeders/seedBaseBdLocations.ts`, `seedCountries.ts`, `seedLocationsDhaka.js`, etc.

**Frontend (bpa_web)**  
- Pickers: `app/owner/_components/location/*.jsx`  
- Map: `src/components/MapPicker.tsx`  
- Country context: `lib/countryContext.ts`  
- Org/branch forms: `app/owner/organizations/new/page.jsx`, `[id]/edit/page.jsx`, `[id]/registration/page.jsx`, `app/owner/_components/branch/BranchForm.jsx`  
- Profile: `app/owner/profile/page.jsx`  
- Product “locations”: `app/owner/products/[id]/locations/page.tsx` (inventory locations).
