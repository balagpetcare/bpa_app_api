# Phase A — Master Data Completion (Union Seeding)

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Mechanism reused:** `npm run seed:location-master` → `prisma/seeders/seedBaseBdLocations.ts`

---

## 1. Duplicate-risk check (before execution)

| Check | Result |
|-------|--------|
| New `bd_unions` table? | **No** — uses existing migration `20260603031500` |
| New seed script? | **No** — `scripts/seed-location-master.ts` already exists |
| New JSON source? | **No** — `prisma/seed-data/bd.areas.json` (UNION rows) |
| Parallel union API? | **No** — `/api/v1/location-master/unions` only |

**Proceed:** Safe to run existing upsert seed.

---

## 2. Pre-seed status

| Model / table | Count |
|---------------|------:|
| `BdDivision` / `bd_divisions` | 8 |
| `BdDistrict` / `bd_districts` | 64 |
| `BdUpazila` / `bd_upazilas` | 495 |
| `BdUnion` / `bd_unions` | **0** |
| `BdArea` / `bd_areas` | 4540 |
| `bd_areas.unionId` populated | **0** |

**Blocker confirmed:** `bd_unions = 0` prevented union API and `validateSelection` union paths.

---

## 3. Seed files verified

| File | Records | Role |
|------|--------:|------|
| `prisma/seed-data/bd.divisions.json` | 8 | Divisions |
| `prisma/seed-data/bd.districts.json` | 64 | Districts |
| `prisma/seed-data/bd.upazilas.json` | 495 | Upazilas |
| `prisma/seed-data/bd.areas.json` | 4540 | All `type: "UNION"` → canonical `bd_unions` + `bd_areas` |

**Import logic** (`seedBaseBdLocations.ts`):

1. Upsert divisions → districts → upazilas (unchanged).
2. Filter areas where `type === 'UNION'` → upsert `bd_unions` by `code` + `upazilaId`.
3. Upsert `bd_areas` with `unionId` resolved from union code or `unionCode` field.

No alternate import path was added (`seed-bd-locations-once.ts` / `seed-locations-only.ts` call the same seeder).

---

## 4. Execution

```bash
npm run seed:location-master
```

**Output:**

```
divisions: 8, districts: 64, upazilas: 495, unions: 4540, areas: 4540
```

**Duration:** ~33s (local dev)

---

## 5. Post-seed verification

### Counts (`npm run verify:location-master`)

| Level | Count | Expected | Status |
|-------|------:|---------:|:------:|
| Divisions | 8 | 8 | Pass |
| Districts | 64 | 64 | Pass |
| Upazilas | 495 | 495 | Pass |
| Unions | 4540 | 4540 | Pass |
| Areas | 4540 | 4540 | Pass |

### Integrity

| Check | Count |
|-------|------:|
| Orphan districts | 0 |
| Orphan upazilas | 0 |
| Orphan unions | 0 |
| Orphan areas by `unionId` | 0 |

### `bd_areas.unionId` linkage

| Metric | Value |
|--------|------:|
| UNION-type areas | 4540 |
| Areas with `unionId` set | 4540 |
| Link rate | **100%** |

Artifact: `docs/location-system-migration/verification-report.json` (updated 2026-06-03T07:32:44Z)

---

## 6. Data safety

- **Operation:** `upsert` only (no deletes).
- **Legacy `bd_areas` rows:** Preserved; `unionId` backfilled in place.
- **No schema change** in this phase.

---

## 7. Phase A outcome

| Item | Status |
|------|:------:|
| Unions seeded | **Complete** |
| `bd_areas.unionId` linked | **Complete** |
| Verification | **Pass** |
| Repair migration needed | **No** |

**Next dependency satisfied:** Entity backfill and union dropdown APIs can run against populated master.
