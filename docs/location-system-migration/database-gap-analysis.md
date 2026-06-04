# Phase 1 — Database Gap Analysis

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Database:** `bpa_pet_db` @ `localhost:5432`  
**Prisma schema:** `prisma/schema.prisma`

## Executive summary

| Area | Status |
|------|--------|
| Master tables (`bd_divisions` → `bd_upazilas`) | Aligned with schema |
| `bd_unions` table | Created by migration; **0 rows** (seed not run) |
| Entity location columns | Present after `20260603031500_centralized_location_system` |
| Entity → master FK constraints | **Not present** (indexes only; application validation) |
| `fundraising_accounts.unionId` | Intentionally absent (uses `areaId`) |
| Shop / Breeder tables | No dedicated tables; use `branches` + `LocationCoverageEntityType` |

During this analysis, migration `20260603031500_centralized_location_system` transitioned from **pending** to **applied**. Gap findings below reflect the **post-migration** state unless noted.

---

## A. Prisma schema (canonical models)

### Master hierarchy

| Prisma model | DB table | Key fields |
|--------------|----------|------------|
| `BdDivision` | `bd_divisions` | `code`, `nameEn`, `nameBn` |
| `BdDistrict` | `bd_districts` | `divisionId` → `BdDivision` |
| `BdUpazila` | `bd_upazilas` | `districtId` → `BdDistrict` |
| `BdUnion` | `bd_unions` | `upazilaId` → `BdUpazila` |
| `BdArea` | `bd_areas` | `unionId`, `upazilaId`, `districtId`, `parentId`, `type` |

### Business entities (location FK columns in schema)

| Entity | Table | `divisionId` | `districtId` | `upazilaId` | `unionId` | `areaId` | Prisma `@relation` to master |
|--------|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| UserProfile | `user_profiles` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| OwnerProfile | `owner_profiles` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| Organization | `organizations` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| Branch (Clinic/Shop via type) | `branches` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| DoctorVerification | `doctor_verifications` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| StaffInvite | `staff_invites` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| ProducerOrg | `producer_orgs` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| ProducerFactory | `producer_factories` | ✓ | ✓ | ✓ | ✓ | ✓ | No |
| FundraisingAccount | `fundraising_accounts` | ✓ | ✓ | ✓ | — | ✓ | Partial (division/district/upazila/area only) |

**Note:** There is no separate `Clinic`, `Doctor`, `Shop`, or `Breeder` table. Clinics and shops are `Branch` records; doctors use `doctor_verifications`; breeders/shops are coverage targets via `LocationCoverageEntityType`.

### Coverage (future-ready, schema present)

- `LocationCoverageAssignment` → `location_coverage_assignments`
- Enum `LocationCoverageEntityType`: `USER`, `STAFF`, `DOCTOR`, `CLINIC`, `SHOP`, `BRANCH`, `ORGANIZATION`, `BREEDER`, `PRODUCER`, `VOLUNTEER`, `RESCUE_TEAM`

### Legacy / parallel models (retained)

- `CityCorporation` / `Area` (Dhaka tree) — `city_corporations`, `areas`
- `LocationPlace` / geo APIs under `/api/v1/me/location` (GPS, not BD master)
- `location_cities`, `location_sub_districts` (global location stack)

---

## B. PostgreSQL vs Prisma — master tables

### Post-migration (current DB)

| Table | Exists | Columns match schema | FKs in DB |
|-------|:------:|:--------------------:|:----------:|
| `bd_divisions` | Yes | Yes | None on divisions |
| `bd_districts` | Yes | Yes (+ lat/lng) | `divisionId` → `bd_divisions` |
| `bd_upazilas` | Yes | Yes (+ lat/lng) | `districtId` → `bd_districts` |
| `bd_unions` | Yes | Yes (+ lat/lng) | `upazilaId` → `bd_upazilas` |
| `bd_areas` | Yes | Yes (+ `unionId`) | `upazilaId`, `districtId`, `parentId`, `unionId` |
| `location_coverage_assignments` | Yes | Yes | **None** (migration adds indexes only) |

### Pre-migration gaps (resolved by `20260603031500`)

- Missing table `bd_unions`
- Missing `bd_areas.unionId`
- Missing location columns on `user_profiles`, `organizations`, `branches`, `doctor_verifications`, `staff_invites`, `producer_orgs`, `producer_factories`
- Missing `owner_profiles.unionId`
- Missing `location_coverage_assignments`

---

## C. PostgreSQL vs Prisma — entity tables

### Location columns (post-migration)

All listed entity tables now have indexed nullable integer columns where defined in Prisma.

### Missing DB constraints vs ideal design (`03-database-design.md`)

| Gap | Severity | Notes |
|-----|----------|-------|
| No FK from `user_profiles.divisionId` etc. to master | Medium | By design in migration (non-breaking); validated in `location.service.validateSelection` |
| No FK on `location_coverage_assignments` location columns | Medium | Same; app-layer validation required |
| `fundraising_accounts` has no `unionId` | Low | Schema and product use `areaId`; UI may send union via `areaId` / `bdArea` |
| Entity Prisma models lack `@relation` to `BdDivision` etc. | Low | Drift from `FundraisingAccount` pattern; optional hardening migration later |

### Schema file drift

- `prisma/schema/40_location.prisma` is **out of date** (no `BdUnion`, no `unionId` on `BdArea`). Canonical source is `prisma/schema.prisma` only.

---

## D. Indexes

Present on all new entity location columns (per migration SQL). Master hierarchy indexes unchanged and correct.

**Missing (design doc, not yet implemented):**

- Parent-scoped unique `code` on districts/upazilas/unions (global `code` unique exists)
- `slug`, `is_active`, `is_verified` columns

---

## E. Data population gaps (not structural)

| Dataset | Expected | Actual (DB) |
|---------|----------|-------------|
| Divisions | 8 | 8 |
| Districts | 64 | 64 |
| Upazilas | 495 | 495 |
| Unions (`bd_unions`) | ~4540 (from seed) | **0** |
| Areas (`bd_areas`, type UNION) | ~4540 | 4540 |
| `bd_areas.unionId` populated | ~4540 after seed | **0** |

---

## F. Recommendations (analysis only — not applied)

1. **Run master seed** after migration on each environment: `npm run seed:location-master` (populates `bd_unions` and links `bd_areas.unionId` via `prisma/seeders/seedBaseBdLocations.ts`).
2. **Run data backfill** for business rows: `npm run migrate:location-references` (reads `addressJson` / legacy IDs).
3. **Optional follow-up migration** (separate release): add FK constraints on entity location columns after backfill verification.
4. **Optional:** add `fundraising_accounts.unionId` only if product requires first-class union storage (see `final-integration-report.md`).
5. Sync or deprecate `prisma/schema/40_location.prisma` to avoid split-schema confusion.

---

## G. Verification commands used

```bash
npx prisma migrate status
npx tsx scripts/tmp-db-gap-report.ts
npx tsx scripts/verify-location-master.ts
npx tsx scripts/location-audit-counts.ts
```

Artifact: `docs/location-system-migration/verification-report.json`
