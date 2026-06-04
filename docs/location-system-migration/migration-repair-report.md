# Phase 2 — Migration Repair Report

**Project:** `D:\BPA_Data\backend-api`  
**Generated:** 2026-06-03

## Objective

Verify migrations that introduce `divisionId`, `districtId`, `upazilaId`, `unionId` (and related structures), detect partial application, and determine if a repair migration is required.

---

## 1. Primary migration

| Property | Value |
|----------|-------|
| Name | `20260603031500_centralized_location_system` |
| Path | `prisma/migrations/20260603031500_centralized_location_system/migration.sql` |
| Type | Additive only (no `DROP`, no data deletion) |

### Creates / alters

1. **CREATE** `bd_unions` (+ FK to `bd_upazilas`, unique `code`, index on `upazilaId`)
2. **ALTER** `bd_areas` ADD `unionId` (+ FK to `bd_unions`)
3. **ALTER** ADD location columns + indexes on:
   - `user_profiles`
   - `owner_profiles` (`unionId` only)
   - `organizations`
   - `branches`
   - `doctor_verifications`
   - `staff_invites`
   - `producer_orgs`
   - `producer_factories`
4. **CREATE** enum `LocationCoverageEntityType`
5. **CREATE** `location_coverage_assignments` (+ unique composite index)

### Does **not** add

- FK from business entity columns to master tables
- `fundraising_accounts.unionId`
- `NOT NULL` constraints on location fields

---

## 2. Historical migrations (already applied)

Earlier migrations introduced BD master and partial entity support:

| Migration | Relevance |
|-----------|-----------|
| `20260116192630_owner_profile_data` | `owner_profiles` division/district/upazila/area; `bd_*` master; `fundraising_accounts` FKs |
| `20260202130000_add_location_place_user_location_profile_event` | `LocationPlace` geo model |
| `20260206120000_owner_profile_address_json` | `addressJson`; explicitly preserves legacy ID columns |

No conflict with centralized migration; columns added in centralized migration were absent on several tables until this migration.

---

## 3. Application status

### Timeline observed during analysis

| Checkpoint | `_prisma_migrations` | DB objects |
|------------|----------------------|------------|
| Initial | Migration **not** recorded | No `bd_unions`, no entity columns on `user_profiles` / `organizations` / etc. |
| Final | Migration **recorded** | All objects from SQL present |

**Conclusion:** Migration was **not** partially applied. State was binary: fully pending → fully applied.

Current status:

```
npx prisma migrate status
→ Database schema is up to date! (259 migrations)
```

---

## 4. Partial-application checks

| Check | Result |
|-------|--------|
| `bd_unions` exists | Yes |
| `bd_areas.unionId` column exists | Yes |
| `user_profiles.divisionId` exists | Yes |
| `location_coverage_assignments` exists | Yes |
| Orphan migration record without objects | No |
| Objects without migration record | No (after apply) |

**Repair migration required:** **No**

---

## 5. Related pending work (not migration repair)

These are **post-migration operational** steps, not schema repair:

| Step | Command / script | Risk |
|------|------------------|------|
| Seed union master from JSON | `npm run seed:location-master` | Low (upsert) |
| Backfill entity IDs from JSON | `npm run migrate:location-references` | Low (updates only when validation passes) |
| Production deploy | `npm run prisma:migrate:deploy` then seed | Standard |

---

## 6. Safe deployment procedure (validated before apply)

```bash
# 1. Validate schema
npx prisma validate

# 2. Review pending migrations
npx prisma migrate status

# 3. Apply (production)
npm run prisma:migrate:deploy

# 4. Verify structure
npx tsx scripts/tmp-db-gap-report.ts   # or manual SQL introspection

# 5. Seed unions + link areas
npm run seed:location-master

# 6. Verify counts
npm run verify:location-master

# 7. Backfill business data (non-destructive)
npm run migrate:location-references
```

---

## 7. Rollback posture

- Migration is additive; rollback = leave columns in place (recommended) or manual column drops in controlled maintenance (not automated).
- **Do not** drop legacy `addressJson`, `location` JSON, or `bd_areas` rows until backfill is verified.

---

## 8. Decision

| Item | Decision |
|------|----------|
| New repair migration | **Not needed** |
| Re-run failed migration | N/A (clean apply) |
| Block production | **Yes**, until `bd_unions` seeded (0 rows after apply) |
