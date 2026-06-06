# Production Seed Classification (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Related:** [SEED_SYSTEM_AUDIT.md](./SEED_SYSTEM_AUDIT.md), [SEED_RECOVERY_PLAN.md](../plans/SEED_RECOVERY_PLAN.md)

---

## 1. Executive summary

| Verdict | Detail |
|---------|--------|
| **Do not run** `npm run db:seed` or `npm run db:deploy` (seed half) on a **populated production database** | Main chain step **18** (`prisma/seeds/seed-master-catalog.ts`) runs `deleteMany` on all `MasterClinicalCatalogItem` and `MasterClinicalCatalogCategory` rows before CSV reload |
| **Safe production approach** | Run **migrations only**, then **targeted standalone scripts** for missing master/reference data |
| **Coverage zones** | Not in main `prisma/seed.ts` chain — use `npm run seed:coverage-zones` |
| **Super Admin user** | Not in Prisma seed — use `npm run admin:bootstrap` with env credentials |
| **Preserves** | Users, orders, org clinic records, inventory ledgers — **when only SAFE/WARNING master seeds below are used** and step 18 is skipped |

### Classification legend

| Class | Meaning |
|-------|---------|
| **SAFE** | Idempotent insert-if-missing, or upsert whose `update` branch is empty / no-op for existing rows. No `deleteMany`, truncate, or reset. Does not touch transactional business tables (orders, stock ledger, patients). |
| **WARNING** | May **update** existing master/reference rows, **create** org-level or campaign data, **assign roles**, or **reset passwords**. Re-runnable but review impact on live data. |
| **DANGEROUS** | `deleteMany`, `migrate reset`, or full seed chain that includes destructive steps. Can break FK links or wipe catalog data in use. |

---

## 2. `package.json` seed commands

| Script | Command | Class | Notes |
|--------|---------|-------|-------|
| `seed` | `node scripts/run-local-prisma.cjs db seed` | **DANGEROUS** (on populated DB) | Runs full `prisma/seed.ts` including step 18 CSV wipe |
| `db:seed` | same as `seed` | **DANGEROUS** (on populated DB) | Alias |
| `db:deploy` | `migrate deploy && db seed` | **DANGEROUS** (on populated DB) | Migrate half is fine; **seed half unsafe** until step 18 is fixed |
| `db:reset` | `migrate reset --force` | **DANGEROUS** | Drops all data, reapplies migrations, runs seed |
| `bootstrap:deploy` | `setup:prisma && migrate deploy` | **SAFE** | Migrations only — **preferred deploy path for existing prod DB** |
| `admin:bootstrap` | `scripts/bootstrap-super-admin.ts` | **WARNING** | Creates or **updates** Super Admin user (password reset), whitelist, `SUPER_ADMIN` role |
| `create:super-admin` / `bootstrap:admin` | alias → `admin:bootstrap` | **WARNING** | Same |
| `seed:location-master` | `scripts/seed-location-master.ts` | **WARNING** | BD divisions→areas via upsert (updates `nameEn`/`nameBn` on existing codes) |
| `seed:dhaka-city` | `scripts/seed-dhaka-city.ts` | **WARNING** | DNCC/DSCC `BdArea` tree upserts |
| `seed:dhaka-metro` | `scripts/seed-dhaka-metro.ts` | **WARNING** | Dhaka BdArea + metro `CoverageZone` upserts |
| `seed:coverage-zones` | `scripts/seed-coverage-zones.ts` | **WARNING** | Full coverage pipeline; upserts zones/metadata/mappings |
| `seed:clinic-vaccine-items` | `scripts/seed-clinic-vaccine-items.ts` | **WARNING** | Creates org-level `clinicalItem` rows (`ORG_ID` required); skips alias matches |
| `seed:campaign-checkout-anchor` | `scripts/seed-campaign-checkout-anchor.ts` | **WARNING** | May create BPA org/branch; updates org/branch status if exists |

**Prisma config seed** (invoked by `db seed`):

```json
"seed": "node -r ts-node/register prisma/seed.ts"
```

---

## 3. Standalone `scripts/seed-*` (no npm alias)

| File | Class | Notes |
|------|-------|-------|
| `scripts/seed-locations-only.ts` | **WARNING** | BD base + Dhaka city + global location tables (upsert/sync) |
| `scripts/seed-bd-locations-once.ts` | **WARNING** | BD base only (`seedBaseBdLocations`) |
| `scripts/seed-demo-catalog.ts` | **WARNING** | ~200 demo `masterProductCatalog` rows (skip if slug exists) — **omit on prod** |
| `scripts/seed-campaign-included-vaccines.js` | **WARNING** | May update campaign pricing; creates included vaccines if none |
| `scripts/seed-test-stock.js` | **WARNING** | Adds stock balances/lots at hardcoded location — **dev/QA only** |

---

## 4. Main chain: `prisma/seed.ts` (27 steps)

| Step | Seeder | File | Class | Production note |
|------|--------|------|-------|-----------------|
| 1 | Bangladesh base locations | `seeders/seedBaseBdLocations.ts` | **WARNING** | Upsert syncs location labels from JSON |
| 2 | Dhaka city BdArea hierarchy | `seeders/dhaka/runDhakaCitySeed.ts` (+ child seeders) | **WARNING** | Upsert-based |
| 3 | Fundraising payout catalog | `seeders/seedFundraisingPayoutCatalog.ts` | **SAFE** | Upsert by code |
| 4 | Branch types | `seeders/seedBranchTypes.ts` | **SAFE** | Upsert by code |
| 4.1 | Animal taxonomy | `seeders/seedAnimalTaxonomy.ts` | **SAFE** | Upsert hierarchy |
| 5 | Organization types | `seeders/seedOrganizationTypes.ts` | **SAFE** | Upsert by code |
| 6 | Roles & permissions (ORG/BRANCH) | `seeders/seedRolesPermissions.ts` | **WARNING** | Upsert updates permission/role labels; adds missing `rolePermission` links (does not delete extras) |
| 7 | Super Admin whitelist | `seeders/seedSuperAdminWhitelist.ts` | **SAFE** | No-op unless `SUPER_ADMIN_WHITELIST_*` env set; then upsert |
| 8 | Membership backfill | `seeders/seedMembershipBackfill.ts` | **WARNING** | Upsert sets owner `orgMember`/`branchMember` roles on **all** orgs |
| 9 | Products master data | `seeders/seedProductsMasterData.ts` | **SAFE** | Create-if-missing categories, units, flavors |
| 10 | Pet categories | `seeders/seedPetCategories.ts` | **SAFE** | Create-if-missing |
| 11 | Product subcategories | `seeders/seedProductSubcategories.ts` | **SAFE** | Create-if-missing |
| 12 | Pet brands | `seeders/seedPetBrands.ts` | **SAFE** | Create-if-missing |
| 13 | Master product catalog | `seeders/seedMasterProductCatalog.ts` | **SAFE** | Skip if slug exists |
| 13.1 | Demo master product catalog | `seeders/seedDemoMasterProductCatalog.ts` | **WARNING** | Creates up to ~200 demo products — **skip on prod** |
| 14 | Countries | `seeders/seedCountries.ts` | **SAFE** | Upsert by code |
| 14.0 | Global location tables | `seeders/location/index.ts` | **WARNING** | Upsert countries/states/cities/sub-districts |
| 14.x | Country policies | `seeders/seedCountryPolicies.ts` | **WARNING** | Upsert features; **updates** `policyDonationRule` amounts for BD |
| 14.1 | Organization countries | `seeders/seedOrganizationCountries.ts` | **WARNING** | `updateMany` sets `countryId=BD` where null only |
| 15 | Global + country roles | `seeders/seedGlobalCountryRoles.ts` | **WARNING** | Upsert roles/permissions; may assign `PLATFORM_ADMIN` to env/whitelist users |
| 16 | Vet regulatory bodies | `seeders/seedVetRegulatoryBodies.ts` | **SAFE** | Create-if-missing |
| 17 | Clinical item categories (per org) | `seeders/seedClinicalItemCategories.ts` | **WARNING** | **Creates** default categories only for orgs with **zero** categories |
| **18** | **Master catalog (CSV)** | **`prisma/seeds/seed-master-catalog.ts`** | **DANGEROUS** | **`deleteMany` all master clinical catalog items + categories**, then `create` from CSV |
| 19 | Master clinical catalog (templates) | `seeders/seedMasterClinicalCatalog.ts` | **SAFE** | Skip-if-exists by slug; adds missing categories/items/templates only |
| 20 | Vaccine types | `seeders/seedVaccineTypes.ts` | **SAFE** | Upsert by code |
| opt | Inbound receive QA | `seeders/seedInboundReceiveQaFixtures.ts` | **SAFE** | Read-only logs unless `SEED_INBOUND_RECEIVE_QA=true` |
| opt | Warehouse phase 1 | `seeders/seedWarehousePhase1Minimal.ts` | **WARNING** | Only if `SEED_WAREHOUSE_PHASE1=true`; creates demo warehouse on first org |

**Not in main chain** (coverage — run via `seed:coverage-zones` / `seed:dhaka-metro`):

| Seeder | File | Class |
|--------|------|-------|
| Metro coverage zones | `seeders/coverage/seedCoverageZones.ts` | **WARNING** |
| DNCC coverage mapping | `seeders/coverage/seedDhakaNorthCity.ts` | **WARNING** |
| DSCC coverage mapping | `seeders/coverage/seedDhakaSouthCity.ts` | **WARNING** |
| Business coverage readiness | `seeders/coverage/seedBusinessCoverageReadiness.ts` | **WARNING** |
| Shared helper | `seeders/coverage/lib/upsertCoverageZone.ts` | **WARNING** (upsert updates zone fields + metadata) |

---

## 5. Legacy / orphan seeders (do not use in production)

| File | Class | Notes |
|------|-------|-------|
| `prisma/seed.js` | **WARNING** | Legacy CityCorporation model; not wired to `npm run seed` |
| `prisma/seed_location.js` | **WARNING** | Duplicate BD logic |
| `prisma/seed_all.js` | **WARNING** | Wrapper → `prisma/seed.js` |
| `prisma/seeders/seedLocationsDhaka.js` | **WARNING** | Broken self-require if run directly |
| `prisma/seeders/seedCityCorporationsAndAreas.js` | **WARNING** | Legacy model |
| `prisma/seeders/seedAnimalTypesAndBreeds.ts` | **SAFE** | Superseded by `seedAnimalTaxonomy.ts`; not in main chain |

---

## 6. Data preservation matrix

When following the **production-safe order** in §7 (skipping step 18 and demo seeds):

| Domain | Preserved? | Caveats |
|--------|------------|---------|
| **Users** | Yes | `admin:bootstrap` resets password for configured Super Admin identity |
| **Orders** | Yes | No seed step writes to order tables |
| **Clinic data** (patients, visits, org items) | Yes | `seedClinicalItemCategories` only touches orgs with no categories; `seed:clinic-vaccine-items` adds items if run |
| **Inventory / stock ledger** | Yes | Unless `seed-test-stock.js` or `SEED_WAREHOUSE_PHASE1=true` |
| **Master clinical catalog** | Yes | **Only if step 18 is NOT run** |
| **Master product catalog** | Yes | Existing slugs skipped; demo catalog omitted |
| **Organizations / branches** | Yes | Except `seed:campaign-checkout-anchor` (creates/updates BPA anchor org) |

---

## 7. Production-safe execution order

**Prerequisites:** `DATABASE_URL` points at production DB. Take a backup before any seed run.

### Phase 0 — Schema only (always first)

```powershell
cd D:\BPA_Data\backend-api
npm run bootstrap:deploy
```

Do **not** use `npm run db:deploy` on an existing populated database (it runs full seed).

### Phase 1 — Location master data

Order matters: base BD → Dhaka courier areas → global tables.

```powershell
npm run seed:location-master
npm run seed:dhaka-city
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/seed-locations-only.ts
```

> **Note:** `seed-locations-only.ts` re-runs steps 1–2 plus global location seed. After `seed:location-master` and `seed:dhaka-city`, it is redundant for BD/Dhaka but is the **only packaged script** that includes `runGlobalLocationSeed`. Alternatively run only the global half via the one-off in §8.1.

**Preserves:** All business data. May sync location label fields on existing codes.

### Phase 2 — Coverage zones

Requires `BdArea` rows (Phase 1). Auto-seeds Dhaka city if `CC-DNCC` missing.

```powershell
npm run seed:coverage-zones
```

Partial metro-only alternative:

```powershell
npm run seed:dhaka-metro
```

**Preserves:** Orders, users, clinic, inventory. Upserts `coverageZone`, `coverageZoneArea`, `coverageZoneMetadata`.

### Phase 3 — Roles & permissions

No dedicated `package.json` script. Run seeders **without** full `db:seed`:

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const r=require('./prisma/seeders/seedRolesPermissions').default; const g=require('./prisma/seeders/seedGlobalCountryRoles').default; (async()=>{ await r(p); await g(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Optional whitelist-only (no user creation):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const w=require('./prisma/seeders/seedSuperAdminWhitelist').default; (async()=>{ await w(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Set env before Phase 3 if `PLATFORM_ADMIN` auto-assign is desired: `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PHONE`, whitelist vars (see `seedGlobalCountryRoles.ts`).

**Preserves:** Users and memberships (except new `userGlobalRole` rows for configured admins). Updates permission/role **labels** to match codebase.

**Skip on prod unless needed:** `seedMembershipBackfill` (step 8) — forces owner membership roles.

### Phase 4 — Clinical catalogs (safe subset)

**Do not run** `prisma/seeds/seed-master-catalog.ts` (step 18).

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const m=require('./prisma/seeders/seedMasterClinicalCatalog').default; const v=require('./prisma/seeders/seedVaccineTypes').default; (async()=>{ await m(p); await v(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Optional org-level default categories (only orgs with **no** categories):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const c=require('./prisma/seeders/seedClinicalItemCategories').default; (async()=>{ await c(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Per-org vaccine clinical items (explicit opt-in):

```powershell
cross-env ORG_ID=123 TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/seed-clinic-vaccine-items.ts
```

**Preserves:** Existing master catalog rows and org clinical items (unless org vaccine seed is run).

### Phase 5 — Product catalogs

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const s=[require('./prisma/seeders/seedProductsMasterData').default, require('./prisma/seeders/seedPetCategories').default, require('./prisma/seeders/seedProductSubcategories').default, require('./prisma/seeders/seedPetBrands').default, require('./prisma/seeders/seedMasterProductCatalog').default]; (async()=>{ for(const fn of s) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

**Do not run** `seedDemoMasterProductCatalog` or `scripts/seed-demo-catalog.ts` on production.

**Preserves:** Existing product catalog slugs; adds only missing master reference rows.

### Phase 6 — Supporting master data (optional)

Run when features need them; all SAFE or low-impact WARNING:

```powershell
# Branch/org types, countries, animal taxonomy, payout methods, vet bodies
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const fns=[require('./prisma/seeders/seedBranchTypes').default, require('./prisma/seeders/seedOrganizationTypes').default, require('./prisma/seeders/seedAnimalTaxonomy').default, require('./prisma/seeders/seedFundraisingPayoutCatalog').default, require('./prisma/seeders/seedCountries').default, require('./prisma/seeders/seedVetRegulatoryBodies').default]; (async()=>{ for(const fn of fns) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

Org country backfill (only null `countryId`):

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const o=require('./prisma/seeders/seedOrganizationCountries').default; (async()=>{ await o(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

### Phase 7 — Super Admin bootstrap

Run **once** per environment (or when rotating credentials). **Not** part of `prisma/seed.ts`.

```powershell
cross-env SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD="<strong-password>" SUPER_ADMIN_NAME="BPA Super Admin" TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register scripts/bootstrap-super-admin.ts
```

Or:

```powershell
cross-env SUPER_ADMIN_PHONE=01XXXXXXXXX SUPER_ADMIN_PASSWORD="<strong-password>" npm run admin:bootstrap
```

Verify:

```powershell
npm run admin:verify
```

**WARNING:** If the email/phone already exists, **password is overwritten**.

---

## 8. Exact commands quick reference

### 8.1 Location data

```powershell
cd D:\BPA_Data\backend-api
npm run seed:location-master
npm run seed:dhaka-city
# Global countries/states/cities (if not already present):
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const {runGlobalLocationSeed}=require('./prisma/seeders/location'); (async()=>{ await runGlobalLocationSeed(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

### 8.2 Coverage zones

```powershell
npm run seed:coverage-zones
```

### 8.3 Roles & permissions

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const r=require('./prisma/seeders/seedRolesPermissions').default; const g=require('./prisma/seeders/seedGlobalCountryRoles').default; (async()=>{ await r(p); await g(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

### 8.4 Clinical catalogs (production-safe)

```powershell
# Master clinical catalog + vaccine types — SKIPS destructive CSV seed
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const m=require('./prisma/seeders/seedMasterClinicalCatalog').default; const v=require('./prisma/seeders/seedVaccineTypes').default; (async()=>{ await m(p); await v(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

### 8.5 Product catalogs

```powershell
cross-env TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register -e "require('dotenv/config'); const p=require('./src/infrastructure/db/prismaClient').default; const s=[require('./prisma/seeders/seedProductsMasterData').default, require('./prisma/seeders/seedPetCategories').default, require('./prisma/seeders/seedProductSubcategories').default, require('./prisma/seeders/seedPetBrands').default, require('./prisma/seeders/seedMasterProductCatalog').default]; (async()=>{ for(const fn of s) await fn(p); await p.$disconnect(); })().catch(e=>{console.error(e);process.exit(1);});"
```

### 8.6 Super Admin bootstrap

```powershell
cross-env SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD="<strong-password>" SUPER_ADMIN_NAME="BPA Super Admin" npm run admin:bootstrap
```

---

## 9. Commands to avoid on production

| Command / step | Reason |
|----------------|--------|
| `npm run db:reset` | Drops entire database |
| `npm run db:seed` / `npm run seed` | Includes step 18 CSV `deleteMany` |
| `npm run db:deploy` (on populated DB) | Runs full seed after migrate |
| `prisma/seeds/seed-master-catalog.ts` (step 18) | Wipes master clinical catalog |
| `scripts/seed-demo-catalog.ts` | Inserts demo products |
| Step 13.1 `seedDemoMasterProductCatalog` | Same |
| `scripts/seed-test-stock.js` | Injects test inventory |
| `SEED_WAREHOUSE_PHASE1=true` + full seed | Creates demo warehouse structure |
| Legacy `prisma/seed.js` | Wrong location model |

---

## 10. Fresh database vs existing production

| Scenario | Recommended path |
|----------|------------------|
| **Brand-new empty DB** (first deploy) | `npm run bootstrap:deploy` then either full `npm run db:seed` **or** phased §7 + `admin:bootstrap`. Full seed acceptable only when no catalog FKs exist yet. |
| **Existing production DB** (users, orders, clinic live) | `npm run bootstrap:deploy` only, then §7 phases 1–7 selectively. **Never** step 18 until [SEED_RECOVERY_PLAN.md](../plans/SEED_RECOVERY_PLAN.md) CSV upsert fix ships. |
| **Post-migration master gap** | Run only the relevant §8 subsection (e.g. new coverage zones after migration `20260603190000_coverage_zones`). |

---

## 11. Environment variables reference

| Variable | Used by | Production guidance |
|----------|---------|---------------------|
| `DATABASE_URL` | All seeds | Required |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PHONE` | `admin:bootstrap`, whitelist, `PLATFORM_ADMIN` assign | Set explicitly; never commit |
| `SUPER_ADMIN_PASSWORD` | `admin:bootstrap` | Required for bootstrap |
| `SUPER_ADMIN_WHITELIST_EMAILS` / `PHONES` | Whitelist seeders | Optional gate for admin panel |
| `ORG_ID` | `seed:clinic-vaccine-items` | Required when seeding org vaccines |
| `SEED_WAREHOUSE_PHASE1` | step opt warehouse | Leave **unset** on prod |
| `SEED_INBOUND_RECEIVE_QA` | QA fixtures | Leave **unset** on prod |
| `SEED_DEMO_PRODUCTS` | Not yet wired | N/A — omit demo catalog manually |

---

## 12. Summary checklist

- [ ] Backup database
- [ ] `npm run bootstrap:deploy` (migrate only)
- [ ] Location: `seed:location-master` → `seed:dhaka-city` → global location
- [ ] Coverage: `seed:coverage-zones`
- [ ] RBAC: targeted roles seeders (§8.3)
- [ ] Clinical: `seedMasterClinicalCatalog` + `seedVaccineTypes` only — **not** CSV step 18
- [ ] Products: master catalog chain — **not** demo catalog
- [ ] Super Admin: `admin:bootstrap` with env credentials
- [ ] Confirm: no `db:seed`, `db:reset`, or `seed-test-stock` on production

---

*Audit complete. No application code was modified.*
