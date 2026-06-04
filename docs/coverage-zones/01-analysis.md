# Phase 1 — Coverage Zone System Analysis

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Related:** `docs/location-system-migration/`, `docs/dhaka-metro-coverage/`

---

## 1. Existing Bangladesh master (`bd_*`)

| Model | Table | Seeder | Duplicate risk |
|-------|-------|--------|----------------|
| `BdDivision` | `bd_divisions` | `seedBaseBdLocations` / `npm run seed:location-master` | **None** — upsert by `code` |
| `BdDistrict` | `bd_districts` | same | **None** |
| `BdUpazila` | `bd_upazilas` | same | **None** |
| `BdUnion` | `bd_unions` | same (from `type=UNION` areas) | **None** |
| `BdArea` | `bd_areas` | same + Dhaka courier tree | **None** when upserting by `code` / `(parentId, nameEn, type)` |

**Counts (expected after `seed:location-master`):** 8 divisions, 64 districts, 495 upazilas, 4540 unions, ~19k+ areas (union rows mirrored in `bd_areas`).

Dhaka district: `DIS-47` under `DIV-6` — already in `prisma/seed-data/bd.*.json`.

---

## 2. Legacy / parallel structures (not duplicated by this work)

| System | Purpose | Relationship to coverage zones |
|--------|---------|--------------------------------|
| `CityCorporation` + `Area` | Legacy Dhaka picker (`/api/v1/locations`) | Unchanged; coverage uses `bd_areas` |
| `location_coverage_assignments` | Per-entity business coverage | Complements `CoverageZone` (operational geography vs entity assignments) |
| `LocationCoverageEntityType` | DOCTOR, CLINIC, SHOP, … | Used by API; business readiness zones document supported types |

---

## 3. `CoverageAreaDesign` (from `coverage-area-design.md`)

- **Problem:** Actors need multi-area service coverage, not only a registered address.
- **Existing table:** `location_coverage_assignments` with composite unique on hierarchy IDs.
- **API:** `GET/PUT /api/v1/location-master/coverage/:entityType/:entityId`
- **Status:** API + schema exist; entity assignment rollout is product-driven.
- **This phase:** Adds **operational zones** (`coverage_zones`) for BPA planning (metro, DNCC/DSCC, readiness templates) without inserting business entities.

---

## 4. `DhakaMetroCoverageDesign`

No separate doc folder existed previously; design is codified in:

- `prisma/seeders/coverage/data/dhaka-metro-coverage.ts` — 5 directional zones + BdArea code map
- `prisma/seeders/dhaka/*` — DNCC/DSCC BdArea courier hierarchy (ported from `schema_final_clean`, upsert-only)
- `docs/dhaka-metro-coverage/README.md`

Metro zones are **not** new `bd_*` rows; they are `CoverageZone` rows pointing at existing `BdArea.id`.

---

## 5. Duplicate-structure verification

| Check | Result |
|-------|--------|
| New `BdDivision` / `BdDistrict` tables | **No** |
| Re-seed national hierarchy in coverage seeders | **No** — `seedDhakaCityCorporations` uses `findUnique` on `DIS-47` / `DIV-6` |
| New Dhaka areas without stable codes | **No** — upsert by `code` or `(parentId, nameEn, type)` |
| Second metro zone table | **No** — only `coverage_zones` |
| Duplicate zone slug | **Prevented** — `slug` unique |
| Duplicate zone↔area map | **Prevented** — `(coverageZoneId, bdAreaId)` unique |

---

## 6. Recommended seed order (new environment)

```bash
npm run prisma:migrate:deploy
npm run seed:location-master
npm run seed:coverage-zones    # auto-runs dhaka-city BdArea seed if CC-DNCC missing
npm run verify:coverage-zones
```

Optional granular commands:

```bash
npm run seed:dhaka-city
npm run seed:dhaka-metro      # BdArea + metro CoverageZone only
```

---

## 7. Gaps / notes

- `seed:location-master` alone does **not** include DNCC/DSCC micro-areas; `seed:coverage-zones` triggers `seed:dhaka-city` when needed.
- Full `npm run seed` still runs legacy `seedLocationsDhaka` (CityCorporation) via old index fallback — unrelated to `coverage_zones`.
- National non-Dhaka operational zones are future work (same `CoverageZone` model).
