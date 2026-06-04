# Coverage Zones — Production Readiness

**Project:** `D:\BPA_Data\backend-api`  
**Date:** 2026-06-03

---

## Deploy runbook

```bash
npm run prisma:migrate:deploy
npm run seed:location-master
npm run seed:coverage-zones
npm run verify:coverage-zones
```

Optional:

```bash
npm run seed:dhaka-city      # BdArea DNCC/DSCC only
npm run seed:dhaka-metro     # BdArea + metro CoverageZone
```

---

## Deliverables

| Item | Count / status |
|------|----------------|
| Coverage zones seeded | 14 |
| Dhaka BdArea mappings in coverage | 258 |
| Metro child locality mappings | 53 |
| Seeder modules | 12+ files under `prisma/seeders/dhaka/` and `prisma/seeders/coverage/` |
| npm scripts | `seed:coverage-zones`, `seed:dhaka-metro`, `seed:dhaka-city`, `verify:coverage-zones` |

---

## Duplicate-risk report

| Action | Risk |
|--------|:----:|
| `seed:location-master` | None — existing upsert |
| `seed:dhaka-city` | None — BdArea upsert by code / composite |
| `seed:coverage-zones` | None — `slug` + `(coverageZoneId, bdAreaId)` unique |
| New `bd_divisions` / districts | **Not created** by coverage seeders |

**Pre-existing (unchanged):** legacy `CityCorporation`/`Area` tree, `location_coverage_assignments` API.

---

## Blockers

| # | Item | Severity |
|---|------|----------|
| 1 | Run migration on each environment before seed | High |
| 2 | Assign real entity coverage via existing API (out of scope) | Low |

---

## Verdict

**Ready** for production deploy with migration + seed runbook. No manual Dhaka area entry required when seeds are used.
