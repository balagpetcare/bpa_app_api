# Phase C — User Profile Location Completion

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03

---

## 1. Duplicate-risk check

| Check | Result |
|-------|--------|
| New profile endpoints? | **No** |
| New location API? | **No** — reuses `validateSelection` |
| New UserProfile model? | **No** |
| Parallel validation logic? | **No** — shared `resolveUserProfileLocationUpdate` |

---

## 2. Existing endpoints (unchanged routes)

| Method | Route | Handler | Role |
|--------|-------|---------|------|
| GET | `/api/v1/me/profile` | `meProfile.controller.getProfile` | Enterprise profile view |
| PATCH | `/api/v1/me/profile` | `meProfile.controller.patchProfile` | Enterprise profile update |
| GET | `/api/v1/user/me` | `profile.controller.getMyProfile` | Legacy full user + profile |
| PATCH | `/api/v1/user/me` | `profile.controller.updateMyProfile` | Legacy profile update |

**Geo location (separate system, not modified):** `/api/v1/me/location` → `LocationPlace` (GPS/manual), not BD master.

---

## 3. Implementation (continuation only)

### Shared helper (new export, same module)

**File:** `src/api/v1/modules/me/meProfile.service.ts`

- `resolveUserProfileLocationUpdate(body)`  
  - Accepts flat body or nested `body.location`.  
  - Uses `asIntOrNull` from `location.validators`.  
  - Uses `centralizedLocationService.validateSelection`.  
  - Supports clearing all IDs with explicit `null` values.

### PATCH — write path

**`patchEnterpriseProfile`** (`/api/v1/me/profile`):

- Accepts: `divisionId`, `districtId`, `upazilaId`, `unionId`, `areaId`, `bdAreaId`, or nested `location: { … }`.
- Persists validated IDs on `user_profiles`.
- Still accepts `address` → `addressJson` (legacy preserved).

**`updateMyProfile`** (`/api/v1/user/me`):

- Calls same `resolveUserProfileLocationUpdate` — no duplicate validation logic.

### GET — read path

**`getEnterpriseProfile`** response `basic.location`:

```json
{
  "divisionId": number | null,
  "districtId": number | null,
  "upazilaId": number | null,
  "unionId": number | null,
  "areaId": number | null
}
```

**`GET /api/v1/user/me`:** Returns full Prisma `profile` include (includes location columns when present).

### Registration / create

- `auth.register` does not set BD location IDs (unchanged; optional future enhancement).

---

## 4. Request body contract (PATCH)

Either flat:

```json
{
  "divisionId": 1,
  "districtId": 10,
  "upazilaId": 100,
  "unionId": 1000,
  "areaId": null
}
```

Or nested:

```json
{
  "location": {
    "divisionId": 1,
    "districtId": 10,
    "upazilaId": 100,
    "unionId": 1000
  }
}
```

Invalid hierarchy → `400` with message from `validateSelection`.

---

## 5. Database alignment

Local DB after centralized migration: `user_profiles` has all five location columns (confirmed by backfill scanning 3 profiles without P2022).

If an environment still lacks columns, apply `20260603031500_centralized_location_system` before deploying this code (see `docs/debug/user-profile-location-schema-gap.md`).

---

## 6. Backfill

`migrateUserProfiles` added to `migrate-location-references.ts` (Phase B). Dev run: 3 scanned, 0 updated.

---

## 7. Phase C outcome

| Capability | Status |
|------------|:------:|
| Create (register) with BD IDs | Not required / unchanged |
| Update with validateSelection | **Complete** (both PATCH paths) |
| View relational IDs | **Complete** (`/me/profile`) |
| Legacy `addressJson` | **Preserved** |
| Duplicate endpoints | **None created** |
