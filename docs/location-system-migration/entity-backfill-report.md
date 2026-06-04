# Phase B — Entity Backfill

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Script reused:** `npm run migrate:location-references` → `scripts/migrate-location-references.ts`

---

## 1. Duplicate-risk check

| Check | Result |
|-------|--------|
| New mapping system? | **No** — uses `location.service.validateSelection` |
| New tables? | **No** |
| New migration file? | **No** |
| Deletes legacy JSON? | **No** — columns only updated when normalized IDs differ |

**Extension in this phase:** Added `migrateUserProfiles()` to the **existing** script (same pattern as owner/org/branch/doctor/producer). No parallel backfill tool created.

---

## 2. Entities covered

| Entity | Table | JSON fallback | Script function |
|--------|-------|---------------|-----------------|
| User profile | `user_profiles` | `addressJson` | `migrateUserProfiles` (**added**) |
| Owner profile | `owner_profiles` | `addressJson` | `migrateOwnerProfiles` |
| Organization | `organizations` | `addressJson` | `migrateOrganizations` |
| Branch / clinic / shop | `branches` | `addressJson` | `migrateBranches` |
| Doctor | `doctor_verifications` | `metadataJson` | `migrateDoctorProfiles` |
| Producer org | `producer_orgs` | `docsJson` | `migrateProducers` |
| Producer factory | `producer_factories` | `addressJson` | `migrateProducers` |

**Clinic / shop:** No separate tables; backfill uses `branches` (capability distinguishes clinic vs shop).

---

## 3. Mapping rules (unchanged)

For each row:

1. Prefer existing relational IDs (`divisionId` … `areaId`).
2. Fall back to JSON keys: `divisionId`, `districtId`, `upazilaId`, `unionId`, `bdAreaId`, `areaId`.
3. Resolve `unionId` from `areaId` via `bd_areas` / `bd_unions` code match.
4. `validateSelection` — skip row if invalid (no data loss).
5. Update only when normalized values differ.

**Preserved:** `addressJson`, `location` JSON, `metadataJson`, `docsJson`, all legacy text fields.

---

## 4. Preconditions

| Precondition | Status |
|--------------|:------:|
| Centralized migration applied | Yes |
| `bd_unions` seeded (4540) | Yes (Phase A) |
| `bd_areas.unionId` linked | Yes (100%) |

---

## 5. Execution

```bash
npm run migrate:location-references
```

**Run timestamp:** 2026-06-03T07:33:37Z

### Results (local `bpa_pet_db`)

| Entity | Scanned | Updated |
|--------|--------:|--------:|
| User profiles | 3 | 0 |
| Owner profiles | 1 | 0 |
| Organizations | 0 | 0 |
| Branches | 0 | 0 |
| Doctor verifications | 0 | 0 |
| Producer orgs | 0 | 0 |
| Producer factories | 0 | 0 |

**Interpretation:** No rows had mappable location hints in columns or JSON; zero updates is expected for sparse dev data. Script completed without errors.

**Artifact:** `docs/location-system-migration/data-migration-report.json`

---

## 6. Production guidance

Re-run on staging/production after backup:

```bash
npm run migrate:location-references
```

Review `data-migration-report.json` for `updated > 0`. Rows that remain unmapped keep legacy JSON; manual review queue for text-only addresses (out of scope for current script).

---

## 7. Phase B outcome

| Item | Status |
|------|:------:|
| Backfill script executed | **Complete** |
| UserProfile included | **Complete** |
| Data deleted | **None** |
| Legacy fields removed | **None** |
