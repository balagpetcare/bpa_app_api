# Phase 4 — Master Data Validation

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Seed source:** `prisma/seed-data/bd.{divisions,districts,upazilas,areas}.json`

---

## 1. Expected vs actual counts

| Level | Expected (seed files) | DB count | Status |
|-------|----------------------:|---------:|:------:|
| Divisions | 8 | 8 | Pass |
| Districts | 64 | 64 | Pass |
| Upazilas | 495 | 495 | Pass |
| Unions (`bd_unions`) | 4540 (all `bd.areas.json` rows are `type: UNION`) | **0** | **Fail** |
| Areas (`bd_areas`) | 4540 | 4540 | Pass |

---

## 2. Integrity checks

| Check | Result |
|-------|--------|
| Orphan districts (no division) | 0 |
| Orphan upazilas (no district) | 0 |
| Orphan unions (no upazila) | 0 (table empty) |
| Orphan `bd_areas` by `unionId` | 0 |
| Orphan `bd_areas` by `upazilaId` | 0 |
| Duplicate `code` in `bd_divisions` | 0 |
| Duplicate `code` in `bd_districts` | 0 |
| Duplicate `code` in `bd_upazilas` | 0 |
| Duplicate `code` in `bd_areas` | 0 |

---

## 3. Union model transition state

The system is in a **dual representation** window:

| Representation | Rows | Notes |
|----------------|-----:|-------|
| `bd_areas` where `type = 'UNION'` | 4540 | Legacy-compatible leaf |
| `bd_unions` canonical table | 0 | Required for `/location-master/unions` and `unionId` FK on `bd_areas` |
| `bd_areas.unionId` populated | 0 | Populated by `seedBaseBdLocations` after `bd_unions` upsert |

**User-facing impact:** Union dropdown returns empty until seed runs.

---

## 4. Seed pipeline

**File:** `prisma/seeders/seedBaseBdLocations.ts`

1. Upsert divisions, districts, upazilas from JSON.
2. Filter `areas` where `type === 'UNION'` → upsert into `bd_unions` (if model exists).
3. Upsert all `bd_areas` with `unionId` linkage when resolvable.

**Command:**

```bash
npm run seed:location-master
```

---

## 5. Verification tooling

| Script | Output |
|--------|--------|
| `npm run verify:location-master` | `docs/location-system-migration/verification-report.json` |
| `scripts/location-audit-counts.ts` | Console table |
| `scripts/location-verify-integrity.ts` | Extended integrity (run after seed) |

### Latest verification snapshot

```json
{
  "counts": { "divisions": 8, "districts": 64, "upazilas": 495, "unions": 0, "areas": 4540 },
  "integrity": {
    "orphanDistricts": 0,
    "orphanUpazilas": 0,
    "orphanUnions": 0,
    "orphanAreasByUnion": 0
  }
}
```

---

## 6. Parallel legacy datasets (informational)

| Table | Count | Role |
|-------|------:|------|
| `city_corporations` | 2 | Dhaka-specific tree |
| `areas` (Dhaka) | 7 | Ward/zone under corporations |
| `location_cities` | 162 | Global city list |
| `location_sub_districts` | 495 | Mirrors upazila count |

These are **not** replacements for `bd_*` master; document for API deprecation planning only.

---

## 7. Production readiness (master data)

| Requirement | Met? |
|-------------|:----:|
| 8 divisions | Yes |
| 64 districts | Yes |
| All upazilas (495) | Yes |
| All unions in `bd_unions` | **No** |
| `bd_areas.unionId` linked | **No** |
| Automated verify script passes union count | **No** |

**Blocker:** Run `seed:location-master` on every environment after `migrate deploy`.

---

## 8. Recommended acceptance criteria (post-seed)

```
divisions = 8
districts = 64
upazilas = 495
unions >= 4540
areas = 4540
areas with unionId populated >= 4540 (or documented exceptions for non-union area types)
orphan* = 0
```

Re-run `npm run verify:location-master` and attach updated `verification-report.json` to release ticket.
