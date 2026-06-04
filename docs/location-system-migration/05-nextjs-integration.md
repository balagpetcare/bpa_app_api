# Next.js Integration Plan (BPA Web)

## Objective

Migrate BPA web location flows to one canonical backend location source with minimal UX disruption.

## 1) Current Integration Challenges

Observed patterns in existing web stack:

- Multiple picker components with overlapping behavior.
- Mixed endpoint usage (`/locations`, `/common/bd`, campaign routes).
- Mixed payload formats and ad-hoc location snapshots.

## 2) Target Frontend Contract

All web forms should operate on a shared location DTO:

- `divisionId`
- `districtId`
- `upazilaId`
- `unionId`
- `areaId` (optional)
- `displayPathBn`
- `displayPathEn`

Only ID fields are authoritative for backend writes.

## 3) UI Component Strategy

## A. Unified hierarchy picker

Create one reusable picker behavior across all modules:

1. Select division
2. Load districts
3. Select district
4. Load upazilas
5. Select upazila
6. Load unions
7. Optional: load areas/wards

## B. Shared hooks/service layer

Frontend data layer functions:

- `fetchDivisions`
- `fetchDistricts(divisionId)`
- `fetchUpazilas(districtId)`
- `fetchUnions(upazilaId)`
- `fetchAreas(unionId)`
- `searchLocation(query, scope)`
- `resolveLocationPath(ids)`

## C. Form-level validation

Before submit:

- enforce required levels up to union
- validate optional area only when selected
- call backend validation endpoint for final check

## 4) Module Rollout Plan (Web)

Priority order:

1. Organization and Branch forms
2. Pet Owner profile and onboarding
3. Doctor/Clinic/Shop registration and update flows
4. Producer/Breeder and Volunteer/Rescue Team forms
5. Campaign and discovery screens

Each migrated screen should switch to canonical DTO and canonical API family.

## 5) Compatibility Handling

During transition:

- adapter functions map legacy response shapes to unified picker contract
- existing saved JSON address snapshots remain readable
- writes gradually shift to standardized ID payload

## 6) Caching and UX Performance

1. Cache parent-level lookups in memory (or SWR/react-query caches).
2. Debounce search requests.
3. Use optimistic option rendering for known parent changes.
4. Persist last valid selection in form draft state.

## 7) Error Handling UX

Display actionable errors:

- invalid hierarchy combinations
- stale location IDs (if master changed)
- network failures and retry states

When validation fails, reset only invalid lower levels; keep valid upper-level selections.

## 8) Acceptance Criteria (Web)

- All listed modules use same location picker contract.
- No module writes free-form hierarchy text as source of truth.
- All create/update requests pass standardized IDs.
- Existing records remain editable without manual data correction for common cases.
