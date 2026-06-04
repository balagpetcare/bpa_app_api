# Phase 3 — Data Migration Report

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03  
**Status:** Plan validated; backfill **not executed** in this phase (per approval gate)

---

## 1. Objective

Map legacy location values into the centralized Bangladesh hierarchy for:

- User profiles (`user_profiles`)
- Organizations (`organizations`)
- Branches / clinics / shops (`branches`)
- Doctors (`doctor_verifications`)
- Producers (`producer_orgs`, `producer_factories`)
- Fundraising (`fundraising_accounts`)
- Owner profiles (`owner_profiles`)

Preserve all existing data; do not remove legacy fields.

---

## 2. Tooling

| Script | Purpose |
|--------|---------|
| `scripts/migrate-location-references.ts` | Backfill relational IDs from columns + JSON |
| `src/modules/location/location.service.ts` | `validateSelection` — hierarchy consistency |
| `npm run migrate:location-references` | Package script entry |

### Migration logic (per entity)

1. Read existing `divisionId` / `districtId` / `upazilaId` / `unionId` / `areaId` if present.
2. Fall back to `addressJson`, `metadataJson`, or `docsJson` keys: `divisionId`, `districtId`, `upazilaId`, `unionId`, `bdAreaId`, `areaId`.
3. Resolve `unionId` from `areaId` when area type is `UNION` or `bd_areas.unionId` is set.
4. Run `validateSelection`; skip row if invalid (no delete).
5. Update only when normalized values differ.

**Covered in script today:**

- `owner_profiles`
- `organizations`
- `branches`
- `doctor_verifications`
- `producer_orgs` + `producer_factories`

**Not in script (gaps):**

- `user_profiles` — columns exist; no dedicated backfill function yet
- `staff_invites`
- `fundraising_accounts` (uses `areaId`; no `unionId` column)

---

## 3. Current database inventory (dev instance)

| Table | Total rows | Rows with any location ID |
|-------|------------|---------------------------|
| `owner_profiles` | 1 | 0 |
| `organizations` | 0 | 0 |
| `branches` | 0 | 0 |
| `doctor_verifications` | 0 | 0 |
| `producer_orgs` | 0 | 0 |
| `fundraising_accounts` | 0 | 0 |

**Impact:** Dev DB has negligible business data; backfill is low risk but provides limited validation signal. Staging/production inventories must be run before cutover.

---

## 4. Legacy data sources

| Source | Used by | Typical keys |
|--------|---------|--------------|
| Relational IDs | `owner_profiles`, `fundraising_accounts` | `divisionId`, `districtId`, `upazilaId`, `areaId` |
| `addressJson` | `organizations`, `branches`, `owner_profiles`, `producer_factories` | `divisionId`, `districtId`, `upazilaId`, `unionId`, `bdAreaId`, `areaId`, text labels |
| `location` JSON | `organizations`, `branches` | `lat`, `lng`, `city`, `state`, `country` (non-BD) |
| `metadataJson` | `doctor_verifications` | Same as address pattern |
| `docsJson` | `producer_orgs` | Embedded location IDs |
| `bd_areas` (type `UNION`) | Union resolution | `code` match → `bd_unions` after seed |

**Legacy text fields** (`bdDivision`, `bdDistrict` on `LocationPlace`) are not auto-mapped; name-based matching would be medium-confidence and is out of scope for the current script.

---

## 5. Preconditions (must complete before backfill)

| # | Precondition | Status |
|---|--------------|--------|
| 1 | `20260603031500_centralized_location_system` applied | Done |
| 2 | `bd_unions` seeded (~4540 rows) | **Pending** (0 rows) |
| 3 | `bd_areas.unionId` linked after union seed | **Pending** |
| 4 | Prisma client regenerated | Done |

Without union seed, `validateSelection` union paths and `resolveUnionFromArea` return incomplete results.

---

## 6. Recommended execution order

```bash
# After migration deploy on target environment
npm run seed:location-master
npm run verify:location-master
npm run migrate:location-references
```

Capture stdout JSON report from `migrate-location-references.ts` (written under `docs/location-system-migration/` when script completes).

---

## 7. Confidence matrix

| Confidence | Condition | Action |
|------------|-----------|--------|
| High | Valid IDs in columns or JSON | Auto-update via script |
| Medium | Valid `areaId` pointing to UNION-type `bd_areas` | Derive `unionId` after seed |
| Low | Text-only address in JSON | Flag for manual review; keep legacy JSON |
| None | Invalid hierarchy per `validateSelection` | Skip update; log in report |

---

## 8. Preservation rules (enforced)

- Do **not** drop `addressJson`, `location`, or legacy `bd_areas` rows.
- Do **not** null out existing IDs unless validation replaces with corrected hierarchy.
- Fundraising: continue using `areaId` until product adds `unionId` column.

---

## 9. Post-migration verification queries

```sql
-- Sample: orgs with JSON hints but null relational IDs (pre-backfill)
SELECT id, "addressJson"
FROM organizations
WHERE ("divisionId" IS NULL AND "addressJson" IS NOT NULL);

-- Orphans after backfill (should be 0)
SELECT COUNT(*) FROM organizations o
WHERE o."districtId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM bd_districts d WHERE d.id = o."districtId");
```

---

## 10. Phase outcome

| Item | Status |
|------|--------|
| Migration script reviewed | Complete |
| Dry-run on dev data | N/A (no rows) |
| Production backfill executed | **Not run** (awaiting approval + union seed) |
| `user_profiles` backfill extension | **Recommended** follow-up |
