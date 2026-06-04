# Phase D — Full Validation Report

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03

---

## 1. Automated toolchain

| Check | Command | Result |
|-------|---------|:------:|
| Prisma validate | `npx prisma validate` | Pass |
| Prisma generate | via `npm run build` prebuild | Pass |
| Migration status | `npx prisma migrate status` | Up to date (259) |
| Typecheck | `npm run typecheck` | Pass |
| Build | `npm run build` | Pass |
| Location unit tests | `npm test -- --testPathPattern=location.controller` | Pass (2/2) |
| Master verify | `npm run verify:location-master` | Pass (8/64/495/4540/4540) |
| Entity backfill | `npm run migrate:location-references` | Pass (exit 0) |
| Union seed | `npm run seed:location-master` | Pass (Phase A) |

---

## 2. Master data validation

| Level | Count | Orphans |
|-------|------:|--------:|
| Divisions | 8 | 0 |
| Districts | 64 | 0 |
| Upazilas | 495 | 0 |
| Unions | 4540 | 0 |
| Areas | 4540 | 0 |
| `bd_areas.unionId` linked | 4540/4540 | — |

---

## 3. Module validation (code + runtime readiness)

| Module | Validation | Notes |
|--------|:----------:|-------|
| Registration | Static | No BD IDs on register (unchanged) |
| Login | Static | No location mutation |
| User profile | **Updated** | PATCH/GET via `meProfile` + legacy `user/me` |
| Organization | Static | `partner_onboarding` + `validateSelection` |
| Branch / clinic / shop | Static | Same as org (branch table) |
| Doctor | Static | `doctorVerification.service` |
| Producer | Static | `producer.service` |
| Fundraising | Static | `divisionId` + `districtId` + (`upazilaId` \| `areaId`) |
| Vaccination campaign | Static | Rollout regions + campaign locations (parallel models) |

**API surface (canonical):** `/api/v1/location-master/*` — no duplicate master API added.

---

## 4. Duplicate-risk assessment (Phase D)

| Area | Risk | Mitigation |
|------|------|------------|
| Master tables | None | Reused `bd_*` only |
| Seed | None | Reused `seedBaseBdLocations` |
| Backfill | Low | Extended existing script only |
| Profile location | None | Shared helper, existing routes |
| `/locations` vs `/location-master` | **Pre-existing** | Document deprecation; not expanded in this phase |

---

## 5. Known non-failures

- Entity backfill `updated: 0` on dev — expected (no JSON/column hints).
- `GET /api/v1/user/me` does not add structured `basic.location` wrapper (returns raw Prisma profile; columns available on `data.profile`).
- Coverage assignments API exists but business rollout not implemented (Phase 6 design only).

---

## 6. Recommended smoke tests (manual / CI)

```http
GET  /api/v1/location-master/divisions
GET  /api/v1/location-master/unions?upazilaId={validId}
POST /api/v1/location-master/validate-selection
PATCH /api/v1/me/profile  { "divisionId": 1, "districtId": … }
GET  /api/v1/me/profile
```

---

## 7. Phase D verdict

| Dimension | Status |
|-----------|--------|
| Build pipeline | **Pass** |
| Master data | **Pass** |
| Profile location wiring | **Pass** |
| E2E automated module tests | Partial (location controller only) |
| **Overall Phase D** | **Pass** for production deploy prerequisites |
