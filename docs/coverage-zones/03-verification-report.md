# Phase 7 — Coverage Zone Verification Report

**Generated:** 2026-06-03  
**Command:** `npm run verify:coverage-zones`  
**JSON artifact:** `docs/coverage-zones/verification-report.json`

---

## 1. Summary

| Metric | Value |
|--------|------:|
| Coverage zones | 14 |
| Zone↔BdArea mappings | 258 |
| Dhaka neighbourhood mappings (`AREA-DNCC-*` / `AREA-DSCC-*`) | 229 |
| Verification | **PASS** |

---

## 2. Integrity checks

| Check | Result |
|-------|:------:|
| Duplicate zone slugs | 0 |
| Duplicate `(coverageZoneId, bdAreaId)` pairs | 0 |
| Orphan `bdAreaId` references | 0 |
| Metro child zones without mappings | 0 |

---

## 3. Dhaka Metro zone mappings

| Slug | Name | Area mappings |
|------|------|-------------:|
| `dhaka-metro` | Dhaka Metro | 0 (parent; metadata only) |
| `dhaka-metro-north` | North Zone | 22 |
| `dhaka-metro-west` | West Zone | 9 |
| `dhaka-metro-central` | Central Zone | 6 |
| `dhaka-metro-east` | East Zone | 5 |
| `dhaka-metro-south` | South Zone | 11 |

**Metro operational localities mapped:** 53 (sum of child zones)

---

## 4. Other zones (post `seed:coverage-zones`)

| Category | Slugs | Notes |
|----------|-------|-------|
| City corporation | `dncc`, `dscc` | All DNCC/DSCC zones + areas discovered in `bd_areas` |
| Business readiness | `doctor-coverage-readiness`, `clinic-coverage-readiness`, `volunteer-coverage-readiness`, `rescue-coverage-readiness`, `vaccination-coverage-readiness`, `shop-delivery-coverage-readiness` | No BdArea rows (templates only) |

---

## 5. Idempotency

Re-running `npm run seed:coverage-zones` uses upsert on `slug` and `(coverageZoneId, bdAreaId)` — counts remain stable; no duplicate zones or mappings observed in dev.

---

## 6. New environment runbook

```bash
npm run prisma:migrate:deploy
npm run seed:location-master
npm run seed:coverage-zones
npm run verify:coverage-zones
```

`seed:coverage-zones` automatically runs `seed:dhaka-city` when `CC-DNCC` is absent.

---

## 7. Production readiness

| Gate | Status |
|------|:------:|
| Migration `20260603190000_coverage_zones` | Applied (dev) |
| Prisma models valid | Pass |
| Seed idempotent | Pass |
| No duplicate `bd_*` master rows | Pass (upsert-only Dhaka areas) |
| Verify script | Pass |

**Verdict:** Ready for staging/production after `prisma migrate deploy` and seed runbook above.
