# Migration and Seed Dependency Audit (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Related:** [PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md](../PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md), [PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md](./PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md)

---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| Is `migrate deploy` safe on production? | **Yes** — when following non-destructive policy; 271 migrations, additive DDL |
| Is `migrate reset` destructive? | **Yes** — drops all data; **forbidden** on production-like DB |
| Must migrations complete before seed? | **Yes** — seeders assume tables/columns from applied migrations exist |
| Does `db:deploy` belong on populated prod? | **No** — migrate half OK; seed half runs destructive step 18 |

**Verified locally:** Node v22.22.0, Prisma 7.8.0, 271 migrations, database schema up to date.

---

## 2. Migration inventory

| Metric | Value |
|--------|-------|
| Migration folders | **271** under `prisma/migrations/` |
| Schema file | `prisma/schema.prisma` |
| Prisma config | `prisma.config.ts` (Prisma 7 — datasource URL here) |
| CLI wrapper | `scripts/run-local-prisma.cjs` (pins local Prisma version) |
| Integrity check | `node scripts/check-migration-integrity.js` |
| Dependency audit | `npm run migrate:audit-deps` |

---

## 3. Production migration policy

From `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`:

| Safe | Forbidden |
|------|-----------|
| `prisma migrate deploy` | `prisma migrate reset` |
| `prisma migrate status` | `prisma db push` (production-like DB) |
| `prisma validate` / `generate` | Editing applied `migration.sql` files |
| New forward migrations after SQL review | Bulk deletes without backup |

**Pre/post migration:** run `node scripts/check-migration-integrity.js`.

---

## 4. Seed dependency on migrations

Seeds are **not** embedded in migrations. They are separate post-migrate steps that require schema readiness.

### 4.1 Critical migration → seed dependencies

| Domain | Representative migration | Tables / enums required | Seed entry |
|--------|-------------------------|-------------------------|------------|
| BD locations | `20260603031500_centralized_location_system` | `bd_division`, `bd_district`, `bd_upazila`, `bd_union`, `bd_area` | `seedBaseBdLocations`, dhaka seeders |
| Global locations | Same + location migrations | `location_country`, `location_state`, `location_city`, `location_sub_district` | `runGlobalLocationSeed` |
| Coverage zones | `20260603190000_coverage_zones` | `coverage_zone`, `coverage_zone_area`, `coverage_zone_metadata` | `seed:coverage-zones` |
| Campaign + coverage | `20260604150000_campaign_booking_coverage_zone` | campaign booking ↔ zone FKs | coverage seeders |
| Clinic master catalog | `20260309120000_add_clinic_master_catalog` | `master_clinical_catalog_*` | `seedMasterClinicalCatalog`, **step 18 CSV** |
| RBAC | Earlier role/permission migrations | `permission`, `role`, `role_permission`, `user_global_role` | `seedRolesPermissions`, `seedGlobalCountryRoles` |
| Super Admin whitelist | admin gate migrations | `super_admin_whitelist` | `seedSuperAdminWhitelist`, `admin:bootstrap` |
| Product master | product catalog migrations | `master_product_catalog`, `brand`, `category` | product seed chain |
| Vaccine types | vaccination module migrations | `vaccine_type` | `seedVaccineTypes` |
| Warehouse phase 1 | warehouse migrations | `warehouse`, `warehouse_zone`, etc. | `seedWarehousePhase1Minimal` (opt-in) |

### 4.2 Order rule

```
prisma generate → migrate deploy → (optional) targeted seeds → admin:bootstrap
```

Running seed **before** migrations complete will fail with missing table/column errors.

---

## 5. `migrate deploy` safety analysis

### 5.1 Why deploy is production-safe (when policy followed)

- Uses only **pending** migrations from `prisma/migrations/`.
- Does not drop data by default; individual SQL files may contain destructive DDL — each release should be reviewed.
- Many recent migrations use `IF NOT EXISTS` guards for redeploy safety (documented in migration comments).
- No automatic seed on `migrate deploy` alone.

### 5.2 Commands

| Command | Includes seed? | Production (populated DB) |
|---------|----------------|-------------------------|
| `npm run bootstrap:deploy` | No | **Recommended** |
| `npm run prisma:migrate:deploy` | No | **Recommended** |
| `npm run db:deploy` | **Yes** (after migrate) | **Avoid** |
| `npm run db:reset` | Yes (after wipe) | **Never** |

---

## 6. `migrate reset` analysis

| Aspect | Behavior |
|--------|----------|
| Data | **All rows dropped** |
| Schema | Dropped and recreated |
| Migrations | All reapplied from scratch |
| Seed | Runs `prisma/seed.ts` automatically |
| Production | **Forbidden** per project policy |

Reset is appropriate **only** for disposable local dev databases.

---

## 7. Seed requires migration completion

| Seeder | Fails without migration |
|--------|-------------------------|
| `seedBaseBdLocations` | `bd_*` tables |
| `runCoverageZoneSeed` | `coverage_zone*` tables |
| `seedMasterClinicalCatalog` | `master_clinical_catalog_*` |
| `seedMasterCatalog` (CSV) | same + CSV file on disk |
| `admin:bootstrap` | `user`, `user_auth`, `role`, `super_admin_whitelist` |
| `seedGlobalCountryRoles` | country-scoped role tables |

**CSV dependency:** `prisma/seed-data/complete_veterinary_master_catalog.csv` must exist on server for step 18 (skip on prod).

**JSON dependency:** `prisma/seed-data/bd.*.json` required for location seeds.

---

## 8. Migration dependency tooling

| Script | Purpose |
|--------|---------|
| `scripts/check-migration-integrity.js` | Checksum drift detection |
| `scripts/check-migration-files.js` | File collision check (`npm run migrate:check-files`) |
| `scripts/audit-migration-dependencies.mjs` | Dependency graph audit |
| `scripts/migration-rollback-simulation.mjs` | Rollback simulation (planning) |

**Recommended pre-deploy:**

```powershell
npm run migrate:check-files
node scripts/check-migration-integrity.js
npm run prisma:migrate:status
npm run bootstrap:deploy
```

---

## 9. Prisma 7 configuration notes

| File | Role |
|------|------|
| `prisma.config.ts` | `datasource.url`, `migrations.path`, `migrations.seed` |
| `package.json` `"prisma"."seed"` | Duplicate seed command (legacy compat) |
| `scripts/run-local-prisma.cjs` | Ensures local Prisma 7.x CLI |

Seeds use `@prisma/adapter-pg` via `src/infrastructure/db/prismaClient` — `prisma generate` must succeed before seed.

---

## 10. Risk matrix

| Action | Data risk | When to use |
|--------|-----------|-------------|
| `migrate deploy` | Low (review SQL) | Every production deploy |
| Targeted SAFE/WARNING seeds | Low–medium | After migrate, per execution plan |
| Full `db:seed` | **High** (step 18) | Empty DB only |
| `migrate reset` | **Total loss** | Local dev only |
| `db push` | Drift / unversioned | **Never** on prod-like DB |

---

## 11. Rollback guidance

| Failure point | Action |
|---------------|--------|
| Migration SQL error mid-deploy | Stop; fix forward with new migration; do not reset prod |
| Drift detected | Stop per policy; see `docs/non_destructive_prisma_drift_recovery_plan.md` |
| Seed step 18 ran accidentally | **DB restore from backup** |
| Migration succeeded, seed failed | DB schema is new; fix seed command and re-run targeted seed only |

---

*Audit complete. No application code was modified.*
