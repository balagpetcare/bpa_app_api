# Phase 5 — Full Module Validation

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Validation type:** Static code + API surface review + unit tests (no full E2E against seeded unions)

---

## 1. Centralized API

| Route prefix | Module | Endpoints |
|--------------|--------|-----------|
| `/api/v1/location-master` | `src/modules/location` | `divisions`, `districts`, `upazilas`, `unions`, `areas`, `search`, `validate-selection` |
| `/api/v1/location-master/coverage/:entityType/:entityId` | Same | GET/PUT coverage (auth + permissions) |

**Tests:** `src/modules/location/location.controller.test.ts` — **PASS**

**Runtime blocker:** `GET /unions` returns empty until `bd_unions` seeded.

---

## 2. Module-by-module matrix

| Module | Storage | Write path uses `validateSelection` | Read path uses master | Status |
|--------|---------|:-----------------------------------:|:---------------------:|:------:|
| Registration | N/A (no BD IDs on register) | — | — | Partial |
| Login | Session only | — | — | N/A |
| User profile (`UserProfile`) | `user_profiles` + `addressJson` | **No** in profile controllers | Columns exist, unused in API | **Gap** |
| Me geo location | `LocationPlace` | Separate normalizer | Not BD master | Parallel system |
| Owner profile | `owner_profiles` | Via backfill script only | Columns + `addressJson` | Partial |
| Organization setup | `organizations` | Yes — `partner_onboarding.controller` | Columns + `addressJson` | Ready |
| Branch / clinic setup | `branches` | Yes — partner onboarding | Columns + `addressJson` | Ready |
| Doctor setup | `doctor_verifications` | Yes — `doctorVerification.service` | Columns + `metadataJson` | Ready |
| Shop setup | `branches` (capability/type) | Same as branch | Same | Ready (no separate shop table) |
| Producer setup | `producer_orgs`, `producer_factories` | Yes — `producer.service` | Columns + JSON | Ready |
| Breeder setup | Coverage enum / branch taxonomy | No dedicated writer | `LocationCoverageEntityType.BREEDER` | Design only |
| Fundraising | `fundraising_accounts` | Partial — `upazilaId` or `areaId` | FK on division/district/upazila/area | Ready (no `unionId` column) |
| Vaccination campaign | `campaign_rollout_regions`, `campaign_pre_registrations`, `campaign_locations` | Campaign-specific services | `divisionId`/`districtId`/`upazilaId` on rollout | Partial |

---

## 3. Registration & login

### Registration (`auth.controller.ts`)

- Creates user + optional `OwnerProfile`; does not set `user_profiles.divisionId`.
- **Gap:** Pet owner registration does not capture BD hierarchy at signup (may be intentional).

### Login

- No location mutation; OK.

---

## 4. Profile

### `UserProfile` (enterprise profile hub)

- Schema supports `divisionId` … `areaId`.
- `profile.controller.ts` / `meProfile.service.ts` — **no** references to `divisionId` or centralized validator found.
- **Gap:** Web `LocationField` integration for user profile requires API update to persist relational IDs.

### Owner profile

- Columns present; KYC/onboarding flows may use `addressJson`.
- Backfill via `migrate-location-references.ts`.

---

## 5. Organization & branch (clinic / shop)

**File:** `src/api/v1/modules/partner_onboarding/partner_onboarding.controller.ts`

- `createOrganization` / `createBranch` / `updateBranch` accept `divisionId`, `districtId`, `upazilaId`, `unionId`, `areaId`.
- Calls `centralizedLocationService.validateSelection` before persist.
- **Requires:** DB columns (post-migration) + seeded unions for union validation.

**Clinic vs shop:** Distinguished by `BranchType`, `capabilitiesJson`, not separate tables.

---

## 6. Doctor

**File:** `src/api/v1/modules/doctor/doctorVerification.service.ts`

- `upsertDraft` normalizes and validates location IDs.
- Persists to `doctor_verifications` columns.
- **Ready** after migration; union validation needs seeded `bd_unions`.

---

## 7. Producer

**File:** `src/api/v1/modules/producer/producer.service.ts`

- `submitKyc` and factory create/update use `validateSelection`.
- Persists `divisionId` … `areaId` on `producer_orgs` / `producer_factories`.

---

## 8. Fundraising

**File:** `src/api/v1/modules/fundraising/fundraising.service.ts`

- Location readiness: `divisionId && districtId && (upazilaId || areaId)`.
- Accepts union-based UI by mapping union selection to `areaId` where needed.
- No `unionId` column on `fundraising_accounts` (documented in `final-integration-report.md`).

---

## 9. Vaccination campaign

- **Campaign locations:** `campaign_locations` (venue model) — separate from BD master.
- **National rollout:** `campaign_rollout_regions`, `campaign_pre_registrations` use `divisionId`, `districtId`, `upazilaId` (migration `20260604120000_campaign_national_rollout`).
- **Demand intelligence:** reads `bd_districts.divisionId` for analytics.
- **Gap:** Rollout region IDs are not FK-constrained to `bd_*` tables.

---

## 10. Legacy / duplicate APIs (still active)

| Prefix | Purpose |
|--------|---------|
| `/api/v1/locations` | Legacy BD + Dhaka + permissions wrapper |
| `/api/v1/common/bd/*` | Older common BD reads |
| `/api/v1/me/location` | GPS / `LocationPlace` |
| Dhaka routes | `locationDhaka.service.ts` |

**Recommendation:** Route new clients to `/api/v1/location-master` only; deprecate overlaps in a later release.

---

## 11. Client integration (cross-repo)

Per `final-integration-report.md`:

- **bpa_web:** `LocationField`, `LocationPickerUnified`, organization wizard — integrated.
- **bpa_app:** `LocationSelectorWidget` in fundraising screens — integrated.

Backend must expose non-empty `/unions` for full UX.

---

## 12. Test summary

| Test | Result |
|------|--------|
| `location.controller.test.ts` | Pass |
| `verify:location-master` | Pass counts for division/district/upazila; unions = 0 |
| Typecheck | Pass |
| Build | Pass |

---

## 13. Module validation verdict

| Area | Verdict |
|------|---------|
| API + services for org/branch/doctor/producer | **Code-ready** |
| User profile persistence | **Not wired** |
| Union master for dropdowns | **Blocked** (empty `bd_unions`) |
| Breeder / shop dedicated flows | **Coverage design only** |
| Campaign | **Operational** with parallel location models |
