# Production Seed Execution Plan (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Planning only — no code changes  
**Related:** [PRODUCTION_SEED_CLASSIFICATION.md](../audits/PRODUCTION_SEED_CLASSIFICATION.md), [PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md](../audits/PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md)

---

## 1. Objectives

Run seeds on production in a way that:

**Preserves:**

- Existing users, organizations, branches, clinics, patients, pets
- Existing orders, inventory, wallets, transactions
- Existing org-level clinical data and catalog customizations

**Adds only:**

- Missing master data (locations, roles, permissions, catalogs)
- Missing reference rows required by new migrations

---

## 2. Preconditions

| # | Check | Command |
|---|-------|---------|
| 1 | Database backup completed | Platform-specific (pg_dump, managed snapshot) |
| 2 | `DATABASE_URL` points at production | `echo $DATABASE_URL` (redact in logs) |
| 3 | Prisma client generated | `npm run setup:prisma` |
| 4 | Migrations applied | `npm run prisma:migrate:status` → "up to date" |
| 5 | Migration integrity | `node scripts/check-migration-integrity.js` |
| 6 | `.env` has Super Admin vars (for Phase 7) | `SUPER_ADMIN_*` (see Super Admin audit) |

**Never** run `npm run db:reset` or `npm run db:seed` on populated production.

---

## 3. Production-safe execution sequence

All commands from repository root: `D:\BPA_Data\backend-api` (adjust path on server).

### Phase 0 — Schema deploy (required first)

```powershell
npm run bootstrap:deploy
```

- Applies pending migrations only.
- Does **not** run seed.
- **Preserves all business data.**

---

### Phase 1 — Location master data

**Purpose:** BD hierarchy, Dhaka courier areas, global location tables.

```powershell
npm run seed:location-master
npm run seed:dhaka-city
```

Global location tables (countries/states/cities/sub-districts):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const {runGlobalLocationSeed}=require('./prisma/seeders/location'); (async()=>{ await runGlobalLocationSeed(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Verify (optional):

```powershell
npm run verify:location-master
```

**Preserves:** Users, orgs, orders, clinic, inventory. Syncs location labels on existing codes.

---

### Phase 2 — Coverage zones

**Requires:** Phase 1 (BdArea rows, migration `20260603190000_coverage_zones`).

```powershell
npm run seed:coverage-zones
```

Verify (optional):

```powershell
npm run verify:coverage-zones
```

**Preserves:** All business data. Upserts `coverageZone`, `coverageZoneArea`, `coverageZoneMetadata`.

---

### Phase 3 — Roles & permissions

**No dedicated npm script.** Run RBAC seeders only (not full `db:seed`):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const r=require('./prisma/seeders/seedRolesPermissions').default; const g=require('./prisma/seeders/seedGlobalCountryRoles').default; (async()=>{ await r(p); await g(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Optional supporting master (SAFE):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const fns=[require('./prisma/seeders/seedBranchTypes').default, require('./prisma/seeders/seedOrganizationTypes').default]; (async()=>{ for(const fn of fns) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

**Skip on prod unless needed:** `seedMembershipBackfill` (overwrites owner membership roles).

**Preserves:** Users (may add `userGlobalRole` for PLATFORM_ADMIN from env). Updates permission/role labels.

---

### Phase 4 — Clinical catalogs (safe subset)

**Critical:** Do **not** run `prisma/seeds/seed-master-catalog.ts` (step 18).

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const m=require('./prisma/seeders/seedMasterClinicalCatalog').default; const v=require('./prisma/seeders/seedVaccineTypes').default; (async()=>{ await m(p); await v(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Optional — default org categories (orgs with **zero** categories only):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const c=require('./prisma/seeders/seedClinicalItemCategories').default; (async()=>{ await c(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Per-org vaccine clinical items (explicit opt-in):

```powershell
cross-env ORG_ID=<org-id> TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/seed-clinic-vaccine-items.ts
```

**Preserves:** Existing master clinical catalog rows and org clinical items.

---

### Phase 5 — Product catalogs

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const s=[require('./prisma/seeders/seedProductsMasterData').default, require('./prisma/seeders/seedPetCategories').default, require('./prisma/seeders/seedProductSubcategories').default, require('./prisma/seeders/seedPetBrands').default, require('./prisma/seeders/seedMasterProductCatalog').default]; (async()=>{ for(const fn of s) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

**Do not run:** `seedDemoMasterProductCatalog` / `scripts/seed-demo-catalog.ts`.

**Preserves:** Existing product slugs; adds missing master reference rows only.

---

### Phase 6 — Supporting reference data (optional)

Run when features require them:

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const fns=[require('./prisma/seeders/seedAnimalTaxonomy').default, require('./prisma/seeders/seedFundraisingPayoutCatalog').default, require('./prisma/seeders/seedCountries').default, require('./prisma/seeders/seedVetRegulatoryBodies').default]; (async()=>{ for(const fn of fns) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Org country backfill (null `countryId` only):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const o=require('./prisma/seeders/seedOrganizationCountries').default; (async()=>{ await o(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Super Admin whitelist (no user creation):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const w=require('./prisma/seeders/seedSuperAdminWhitelist').default; (async()=>{ await w(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

---

### Phase 7 — Super Admin bootstrap (mandatory for admin panel login)

```powershell
cross-env SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD="<strong-password>" SUPER_ADMIN_NAME="BPA Super Admin" npm run admin:bootstrap
```

Verify:

```powershell
npm run admin:verify
```

See [SUPER_ADMIN_BOOTSTRAP_AUDIT.md](../audits/SUPER_ADMIN_BOOTSTRAP_AUDIT.md).

---

## 4. Scenario matrix

| Scenario | Phases to run |
|----------|---------------|
| **New empty DB** (first deploy) | 0 → full chain acceptable OR 0–7; `admin:bootstrap` required |
| **Existing prod** (live data) | 0 → 1–7 selective; **never** step 18 / full `db:seed` |
| **Post-migration: coverage only** | 0 → 1 (if BdArea missing) → 2 |
| **Post-migration: RBAC only** | 0 → 3 |
| **Post-migration: clinical templates** | 0 → 4 (safe subset only) |
| **Admin lockout recovery** | 7 only (+ verify) |

---

## 5. Production refresh procedure (master data only)

When production is healthy but reference data is stale after a release:

1. Backup database.
2. `npm run bootstrap:deploy` (apply new migrations).
3. Run **only** phases affected by the release (see release notes).
4. `npm run admin:verify` if auth/RBAC changed.
5. Smoke-test: location picker, coverage booking, admin login, clinic catalog installer.

**Do not** re-run full `db:seed` as a "refresh."

---

## 6. Rollback plan

| If this fails… | Rollback action |
|----------------|-----------------|
| Migration (Phase 0) | Stop deploy; restore DB from backup; do not run seeds |
| Location/coverage seed | Generally forward-fix; upserts are reversible only via backup (no auto-rollback) |
| RBAC seed | Forward-fix; restore `role`/`permission` from backup if labels broke integrations |
| Step 18 accidentally run | **Restore DB from backup** — catalog IDs may have changed, breaking org `clinicalItem` FK links |
| `admin:bootstrap` wrong password | Re-run with correct `SUPER_ADMIN_PASSWORD` or restore `user_auth` from backup |

**Primary rollback:** Point-in-time database restore from pre-seed backup.

---

## 7. Checklist

- [ ] Backup completed
- [ ] `bootstrap:deploy` succeeded
- [ ] `check-migration-integrity.js` passed
- [ ] Location seeds (if needed)
- [ ] Coverage seeds (if needed)
- [ ] RBAC seeds (if needed)
- [ ] Clinical safe subset (if needed) — **not** CSV step 18
- [ ] Product catalogs (if needed) — **not** demo catalog
- [ ] `admin:bootstrap` + `admin:verify`
- [ ] Application smoke tests passed

---

*Plan only. No code was modified.*
