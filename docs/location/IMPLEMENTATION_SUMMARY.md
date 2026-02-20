# Location System Implementation Summary

**Reference:** [LOCATION_SPEC.md](./LOCATION_SPEC.md), [API_CONTRACTS.md](./API_CONTRACTS.md), [MIGRATION_PLAN.md](./MIGRATION_PLAN.md)

Step-by-step implementation with minimal risk. All existing behavior preserved; additive only.

---

## 1. File List Changed

### 1.1 Schema and migration

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added model `Place` (id, latitude, longitude, countryCode?, stateName?, cityName?, formattedAddress?, rawAddressJson?, createdAt, updatedAt). Added `User.currentPlaceId` (optional FK to Place). Added `BranchProfileDetails.coverageRadiusKm` (Float?, optional). |
| `prisma/migrations/20260202120000_add_place_and_service_area_radius/migration.sql` | New migration: create table `places`, add `users.currentPlaceId`, add `branch_profile_details.coverageRadiusKm`, FK and indexes. |

### 1.2 Me (user location)

| File | Change |
|------|--------|
| `src/api/v1/modules/me/me.controller.ts` | Added `getLocation` (GET /me/location), `setLocation` (PUT /me/location). Exported in module.exports. |
| `src/api/v1/modules/me/me.routes.ts` | Registered `GET /location` (auth, getLocation), `PUT /location` (auth, setLocation). |

### 1.3 Locations (nearby)

| File | Change |
|------|--------|
| `src/api/v1/modules/locations/locations.controller.ts` | Added `haversineKm` helper and `getNearby` (GET /locations/nearby). |
| `src/api/v1/modules/locations/locations.routes.ts` | Registered `GET /nearby`, ctrl.getNearby. |

### 1.4 Meta (country policy read-only)

| File | Change |
|------|--------|
| `src/api/v1/modules/meta/meta.controller.ts` | Required `getActiveStatePolicy`; added `getPolicy` (GET /meta/policy?countryCode=&stateCode=). |
| `src/api/v1/modules/meta/meta.routes.ts` | Registered `GET /policy`, ctl.getPolicy. |

### 1.5 Documentation

| File | Change |
|------|--------|
| `docs/location/IMPLEMENTATION_SUMMARY.md` | This file (file list, migration notes, tests). |

**No files removed.** No existing routes or fields deleted.

---

## 2. Migration Notes

### 2.1 Apply migration

From repo root (backend-api):

```bash
npx prisma migrate deploy
```

Or for dev (creates migration record and applies):

```bash
npx prisma migrate dev --name add_place_and_service_area_radius
```

If you already created the migration folder manually, ensure the migration name matches. If Prisma generates a different timestamp, you can rename the folder to match `prisma migrate status` or run `prisma migrate resolve` as needed.

### 2.2 What the migration does

- **Creates table `places`**  
  Columns: id, latitude, longitude, countryCode, stateName, cityName, formattedAddress, rawAddressJson, createdAt, updatedAt. Index on (latitude, longitude).

- **Alters table `users`**  
  Adds nullable `currentPlaceId` (FK to places.id ON DELETE SET NULL). Index on currentPlaceId.

- **Alters table `branch_profile_details`**  
  Adds nullable `coverageRadiusKm` (DOUBLE PRECISION). No default; existing rows keep NULL.

### 2.3 Rollback

No automatic rollback script. To undo manually (only if you have no data in `places` and no reliance on new columns):

- Drop FK and column: `users.currentPlaceId`.
- Drop column: `branch_profile_details.coverageRadiusKm`.
- Drop table: `places`.

Existing data in other tables is unchanged.

### 2.4 After migration

Run:

```bash
npx prisma generate
```

so the Prisma client includes Place and the new fields.

---

## 3. Tests Added

**No test framework is present in the repository** (no Jest/Vitest config, no `__tests__` or `*.test.ts` files). Therefore **no automated tests were added** in this implementation.

**Suggested tests (when you add a test setup):**

1. **Place and user location**  
   - GET /api/v1/me/location returns 200 and null when user has no place.  
   - PUT /api/v1/me/location with valid lat/lng creates a Place and sets user.currentPlaceId; GET then returns that place.  
   - PUT with missing lat/lng returns 400.

2. **Nearby**  
   - GET /api/v1/locations/nearby?latitude=&longitude= returns 200 and an array (possibly empty).  
   - Invalid or missing latitude/longitude returns 400.  
   - With seeded branches that have profileDetails.latitude/longitude, assert ordering by distance and radiusKm filter.

3. **Country policy read-only**  
   - GET /api/v1/meta/policy?countryCode=BD returns 200 and policy shape (or 404 if no active policy).  
   - Missing countryCode returns 400.  
   - Optional stateCode returns state override when state policy exists.

4. **Regression**  
   - Existing location endpoints (geocode, reverse-geocode, search, resolve, divisions, districts, etc.) still return expected shapes.  
   - Owner org/branch create/update still accept addressJson and location fields as before.

---

## 4. Behavior Preserved

- **addressJson** on Organization and Branch: unchanged; still read and written by owner APIs.  
- **BranchProfileDetails** latitude, longitude, coveragePolygon: unchanged; still in schema; owner branch profile API can be extended later to write them and coverageRadiusKm.  
- **Locations module** existing routes: countries, city-corporations, areas, divisions, districts, upazilas, bd-areas, search, resolve, geocode, reverse, reverse-geocode: unchanged.  
- **Country/state policies** and policy engine: unchanged; GET /meta/policy is additive read-only.  
- **Ports and scripts:** no changes (API 3000, Next.js 3100–3105).

---

## 5. New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/v1/me/location | Yes | Get current user's saved place (Place shape); null if none. |
| PUT | /api/v1/me/location | Yes | Set current user's place (body: latitude, longitude, optional countryCode, stateName, cityName, formattedAddress). |
| GET | /api/v1/locations/nearby | No | Query: latitude, longitude, radiusKm (default 10), limit (default 20). Returns branches with profileDetails.lat/lng within radius, sorted by distance. |
| GET | /api/v1/meta/policy | No | Query: countryCode (required), stateCode (optional). Returns active country policy (and state override if stateCode given). 404 if no active policy. |

---

## 6. Universal Location Picker (frontend)

**Backend support for the universal location picker is in place:** GET/PUT /me/location accept and return a Place-shaped payload (lat/lng + optional address fields). No frontend UI code was added in this implementation. Use [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) to place the picker on profile, org/branch forms, checkout, and clinic booking when those pages are built.
