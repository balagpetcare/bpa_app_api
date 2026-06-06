# Production Seed Classification (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Related:** [SEED_SYSTEM_AUDIT.md](./SEED_SYSTEM_AUDIT.md), [PRODUCTION_SEED_EXECUTION_PLAN.md](../plans/PRODUCTION_SEED_EXECUTION_PLAN.md), [PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md](./PRODUCTION_DEPLOY_AND_SEED_MASTER_REPORT.md)

---

## 1. Executive summary

| Verdict | Detail |
|---------|--------|
| **Do not run** `npm run db:seed` / `db:deploy` (seed half) on a **populated production DB** | Step 18 (`prisma/seeds/seed-master-catalog.ts`) runs `deleteMany` on all master clinical catalog rows |
| **Safe production approach** | `npm run bootstrap:deploy` then targeted standalone seeds (see execution plan) |
| **Coverage zones** | Not in main `prisma/seed.ts` — use `npm run seed:coverage-zones` after migrations |
| **Super Admin user** | Not in Prisma seed — `npm run admin:bootstrap` is **mandatory** for admin login |
| **Runtime stack** | Node.js **22.22.0**, Prisma **7.8.0**, TypeScript **5.9.3**, ts-node **10.9.2** — verified compatible |

### Classification legend

| Class | Characteristics |
|-------|-----------------|
| **SAFE** | Upsert with empty/no-op update, or create-if-missing only. No `deleteMany`, truncate, drop, reset, or destructive SQL. |
| **WARNING** | Updates existing rows, rebuilds/syncs reference tables, creates org-level data, assigns roles, resets passwords. |
| **DANGEROUS** | `deleteMany`, truncate, drop, `migrate reset`, destructive catalog replacement, raw SQL deletion. |

---

## 2. Seed entry points

| Entry | Path / command | Wired to npm? | Class (populated prod) |
|-------|----------------|---------------|------------------------|
| Canonical Prisma seed | `prisma/seed.ts` via `prisma.config.ts` + `package.json` `"prisma"."seed"` | `seed`, `db:seed` | **DANGEROUS** |
| Super Admin bootstrap | `scripts/bootstrap-super-admin.ts` | `admin:bootstrap` | **WARNING** |
| Location master | `scripts/seed-location-master.ts` | `seed:location-master` | **WARNING** |
| Dhaka city areas | `scripts/seed-dhaka-city.ts` | `seed:dhaka-city` | **WARNING** |
| Dhaka metro coverage | `scripts/seed-dhaka-metro.ts` | `seed:dhaka-metro` | **WARNING** |
| Full coverage pipeline | `scripts/seed-coverage-zones.ts` | `seed:coverage-zones` | **WARNING** |
| Combined locations | `scripts/seed-locations-only.ts` | No | **WARNING** |
| BD locations once | `scripts/seed-bd-locations-once.ts` | No | **WARNING** |
| Clinic vaccine items | `scripts/seed-clinic-vaccine-items.ts` | `seed:clinic-vaccine-items` | **WARNING** |
| Campaign checkout anchor | `scripts/seed-campaign-checkout-anchor.ts` | `seed:campaign-checkout-anchor` | **WARNING** |
| Demo product catalog | `scripts/seed-demo-catalog.ts` | No | **WARNING** |
| Campaign included vaccines | `scripts/seed-campaign-included-vaccines.js` | No | **WARNING** |
| Test stock injection | `scripts/seed-test-stock.js` | No | **WARNING** (dev only) |
| Legacy seed | `prisma/seed.js` | No | **WARNING** (wrong model) |
| Legacy all-seed | `prisma/seed_all.js` | No | **BROKEN** (missing `seed_social.js`) |
| Legacy location | `prisma/seed_location.js` | No | **WARNING** |

**Prisma 7 seed config** (both locations must agree):

- `prisma.config.ts` → `migrations.seed: "node -r ts-node/register prisma/seed.ts"`
- `package.json` → `"prisma"."seed": "node -r ts-node/register prisma/seed.ts"`

---

## 3. `package.json` command classification

| Script | Class | Production safe? |
|--------|-------|------------------|
| `bootstrap:deploy` | **SAFE** | Yes — migrate only |
| `prisma:migrate` / `prisma:migrate:deploy` | **SAFE** | Yes |
| `seed` / `db:seed` | **DANGEROUS** | No on populated DB |
| `db:deploy` | **DANGEROUS** | No on populated DB (includes full seed) |
| `db:reset` | **DANGEROUS** | Never on production |
| `admin:bootstrap` | **WARNING** | Yes with care (password reset) |
| `admin:verify` | **SAFE** | Yes — read-only |
| `seed:location-master` | **WARNING** | Yes — master sync |
| `seed:dhaka-city` | **WARNING** | Yes |
| `seed:dhaka-metro` | **WARNING** | Yes |
| `seed:coverage-zones` | **WARNING** | Yes — after location migration |
| `seed:clinic-vaccine-items` | **WARNING** | Opt-in per org |
| `seed:campaign-checkout-anchor` | **WARNING** | Campaign infra only |
| `verify:location-master` | **SAFE** | Yes |
| `verify:coverage-zones` | **SAFE** | Yes |

---

## 4. Main chain (`prisma/seed.ts`) — 27 steps

| Step | File | Class | Idempotent | Prod safe |
|------|------|-------|------------|-----------|
| 1 | `seeders/seedBaseBdLocations.ts` | WARNING | Yes | Yes* |
| 2 | `seeders/dhaka/runDhakaCitySeed.ts` (+ children) | WARNING | Yes | Yes* |
| 3 | `seeders/seedFundraisingPayoutCatalog.ts` | SAFE | Yes | Yes |
| 4 | `seeders/seedBranchTypes.ts` | SAFE | Yes | Yes |
| 4.1 | `seeders/seedAnimalTaxonomy.ts` | SAFE | Yes | Yes |
| 5 | `seeders/seedOrganizationTypes.ts` | SAFE | Yes | Yes |
| 6 | `seeders/seedRolesPermissions.ts` | WARNING | Yes | Yes* |
| 7 | `seeders/seedSuperAdminWhitelist.ts` | SAFE/WARNING | Yes | Yes* (env-gated) |
| 8 | `seeders/seedMembershipBackfill.ts` | WARNING | Yes | Caution |
| 9 | `seeders/seedProductsMasterData.ts` | SAFE | Yes | Yes |
| 10 | `seeders/seedPetCategories.ts` | SAFE | Yes | Yes |
| 11 | `seeders/seedProductSubcategories.ts` | SAFE | Yes | Yes |
| 12 | `seeders/seedPetBrands.ts` | SAFE | Yes | Yes |
| 13 | `seeders/seedMasterProductCatalog.ts` | SAFE | Yes | Yes |
| 13.1 | `seeders/seedDemoMasterProductCatalog.ts` | WARNING | Yes | **No** (demo data) |
| 14 | `seeders/seedCountries.ts` | SAFE | Yes | Yes |
| 14.0 | `seeders/location/index.ts` | WARNING | Yes | Yes* |
| 14.x | `seeders/seedCountryPolicies.ts` | WARNING | Yes | Caution |
| 14.1 | `seeders/seedOrganizationCountries.ts` | WARNING | Yes | Yes (null only) |
| 15 | `seeders/seedGlobalCountryRoles.ts` | WARNING | Yes | Yes* |
| 16 | `seeders/seedVetRegulatoryBodies.ts` | SAFE | Yes | Yes |
| 17 | `seeders/seedClinicalItemCategories.ts` | WARNING | Yes | Yes* |
| **18** | **`prisma/seeds/seed-master-catalog.ts`** | **DANGEROUS** | No | **No** |
| 19 | `seeders/seedMasterClinicalCatalog.ts` | SAFE | Yes | Yes |
| 20 | `seeders/seedVaccineTypes.ts` | SAFE | Yes | Yes |
| opt | `seeders/seedInboundReceiveQaFixtures.ts` | SAFE | Yes | Yes (no writes) |
| opt | `seeders/seedWarehousePhase1Minimal.ts` | WARNING | Yes | **No** (if env set) |

\*Safe for master/reference sync; does not delete business transactional data.

**Not in main chain** — coverage (`prisma/seeders/coverage/`):

| File | Class | Idempotent | Prod safe |
|------|-------|------------|-----------|
| `coverage/seedCoverageZones.ts` | WARNING | Yes | Yes |
| `coverage/seedDhakaNorthCity.ts` | WARNING | Yes | Yes |
| `coverage/seedDhakaSouthCity.ts` | WARNING | Yes | Yes |
| `coverage/seedBusinessCoverageReadiness.ts` | WARNING | Yes | Yes |
| `coverage/lib/upsertCoverageZone.ts` | WARNING | Yes | Yes |

---

## 5. Per-file production safety review

### 5.1 Active seeders (`prisma/seeders/`)

| File | Purpose | Dependencies | Idempotent | Prod safe | Risk |
|------|---------|--------------|------------|-----------|------|
| `seedBaseBdLocations.ts` | BD divisions→areas from `prisma/seed-data/bd.*.json` | JSON files, `bd_*` tables | Yes | Yes | Low — label sync |
| `dhaka/runDhakaCitySeed.ts` | Orchestrates DNCC/DSCC BdArea tree | Dhaka seeders, `bdArea` | Yes | Yes | Low |
| `dhaka/seedDhakaNorthCityBdAreas.ts` | DNCC area rows | `bdArea` | Yes | Yes | Low |
| `dhaka/seedDhakaSouthCityBdAreas.ts` | DSCC area rows | `bdArea` | Yes | Yes | Low |
| `dhaka/seedDhakaCityCorporations.ts` | City corp BdArea nodes | `bdArea` | Yes | Yes | Low |
| `dhaka/seedDhakaCityZones.ts` | Zone buckets | `bdArea` | Yes | Yes | Low |
| `dhaka/seedDhakaCityAreas.ts` | Neighbourhood areas | `bdArea` | Yes | Yes | Low |
| `seedFundraisingPayoutCatalog.ts` | bKash/Nagad/Rocket/Bank payout methods | `payoutMethod` | Yes | Yes | Low |
| `seedBranchTypes.ts` | Clinic/shop/hub/warehouse types | `branchType` | Yes | Yes | Low |
| `seedAnimalTaxonomy.ts` | Pet taxonomy hierarchy | taxonomy tables | Yes | Yes | Low |
| `seedOrganizationTypes.ts` | Org type dropdown values | `organizationType` | Yes | Yes | Low |
| `seedRolesPermissions.ts` | ORG/BRANCH RBAC matrix | `permission`, `role`, `rolePermission` | Yes | Yes* | Medium — label updates |
| `seedSuperAdminWhitelist.ts` | Whitelist rows from env | `superAdminWhitelist`, env | Yes | Yes* | Low — env only |
| `seedMembershipBackfill.ts` | Owner org/branch memberships | `orgMember`, `branchMember` | Yes | Caution | Medium — role overwrite |
| `seedProductsMasterData.ts` | Categories, units, flavors | `category`, `unit`, `flavor` | Yes | Yes | Low |
| `seedPetCategories.ts` | Pet product categories | `category` | Yes | Yes | Low |
| `seedProductSubcategories.ts` | Extended subcategories | `category` | Yes | Yes | Low |
| `seedPetBrands.ts` | Brand master list | `brand` | Yes | Yes | Low |
| `seedMasterProductCatalog.ts` | Global shop catalog entries | `masterProductCatalog`, brands/categories | Yes | Yes | Low |
| `seedDemoMasterProductCatalog.ts` | ~200 demo products | `masterProductCatalog` | Yes | **No** | Medium — demo pollution |
| `seedCountries.ts` | BD, IN, US countries | `country` | Yes | Yes | Low |
| `location/seedGlobalCountries.ts` | Global country rows | `locationCountry` | Yes | Yes | Low |
| `location/seedGlobalStates.ts` | States/provinces | `locationState` | Yes | Yes | Low |
| `location/seedGlobalCities.ts` | Cities | `locationCity` | Yes | Yes | Low |
| `location/seedGlobalSubDistricts.ts` | Sub-districts/upazilas | `locationSubDistrict`, seed-data | Yes | Yes | Low |
| `location/index.ts` | Runs global location chain | above | Yes | Yes | Low |
| `seedCountryPolicies.ts` | BD donation/product policy | `policyFeature`, `policyDonationRule` | Yes | Caution | Medium — amount updates |
| `seedOrganizationCountries.ts` | Backfill `countryId=BD` where null | `organization` | Yes | Yes | Low |
| `seedGlobalCountryRoles.ts` | Global/country roles + PLATFORM_ADMIN assign | `role`, env admins | Yes | Yes* | Medium — role assign |
| `seedVetRegulatoryBodies.ts` | Vet verification reference | regulatory tables | Yes | Yes | Low |
| `seedClinicalItemCategories.ts` | Default categories per org (empty only) | `clinicalItemCategory` | Yes | Yes* | Low — new orgs only |
| `seedMasterClinicalCatalog.ts` | Templates + catalog extensions | `masterClinicalCatalog*` | Yes | Yes | Low |
| `seedVaccineTypes.ts` | Vaccine type master | `vaccineType` | Yes | Yes | Low |
| `seedClinicalVaccineItems.ts` | Org-level vaccine clinical items | `clinicalItem`, `ORG_ID` | Partial | Opt-in | Medium — creates items |
| `seedInboundReceiveQaFixtures.ts` | QA diagnostics log | none (read) | Yes | Yes | None |
| `seedWarehousePhase1Minimal.ts` | Demo warehouse structure | `warehouse*`, first org | Yes | **No** | Medium — demo infra |
| `coverage/*` | BPA coverage zones | `coverageZone*`, `bdArea` | Yes | Yes | Low |

### 5.2 Seeds module (`prisma/seeds/`)

| File | Purpose | Dependencies | Idempotent | Prod safe | Risk |
|------|---------|--------------|------------|-----------|------|
| `seed-master-catalog.ts` | CSV reload of master clinical catalog | `prisma/seed-data/complete_veterinary_master_catalog.csv` | **No** | **No** | **Critical** — `deleteMany` all categories/items |

### 5.3 Standalone scripts (`scripts/seed-*`)

| File | Purpose | Dependencies | Idempotent | Prod safe | Risk |
|------|---------|--------------|------------|-----------|------|
| `seed-location-master.ts` | BD base only | `seedBaseBdLocations` | Yes | Yes | Low |
| `seed-dhaka-city.ts` | Dhaka BdArea tree | `runDhakaCitySeed` | Yes | Yes | Low |
| `seed-locations-only.ts` | BD + Dhaka + global | steps 1–2 + global | Yes | Yes | Low |
| `seed-bd-locations-once.ts` | BD base (alt prisma client) | `seedBaseBdLocations` | Yes | Yes | Low |
| `seed-coverage-zones.ts` | Full coverage + auto-dhaka | coverage seeders | Yes | Yes | Low |
| `seed-dhaka-metro.ts` | Metro zones subset | coverage partial | Yes | Yes | Low |
| `seed-clinic-vaccine-items.ts` | Org vaccine items | `ORG_ID` env | Partial | Opt-in | Medium |
| `seed-campaign-checkout-anchor.ts` | BPA campaign org/branch | `organization`, `branch` | Yes | Caution | Medium |
| `seed-demo-catalog.ts` | Demo products only | demo seeder | Yes | **No** | Medium |
| `seed-campaign-included-vaccines.js` | Campaign vaccine package rows | campaign slug | Partial | Caution | Medium |
| `seed-test-stock.js` | Stock at location #2 | raw SQL/pg, hardcoded IDs | Yes | **No** | High — inventory |

### 5.4 Legacy / dead paths

| File | Purpose | Status | Risk |
|------|---------|--------|------|
| `prisma/seed.js` | Legacy CityCorporation Dhaka seed | Dead path (not npm) | Wrong schema model |
| `prisma/seed_all.js` | Chains seed.js + social + location | **Broken** — `seed_social.js` missing | Will throw on require |
| `prisma/seed_location.js` | Duplicate BD JSON seed | Dead path | Low |
| `seeders/seedLocationsDhaka.js` | `cityCorporation` model | Legacy | Schema drift risk |
| `seeders/seedCityCorporationsAndAreas.js` | Legacy corporations | Dead | Schema drift |
| `seeders/seedAnimalTypesAndBreeds.ts` | Old taxonomy | Superseded | Unused |

---

## 6. Runtime compatibility (Node 22 / Prisma / ts-node / TS)

| Component | Version (verified) | Seed compatibility |
|-----------|-------------------|-------------------|
| Node.js | v22.22.0 | OK — all seed scripts use `node -r ts-node/register` |
| Prisma CLI | 7.8.0 (package.json `^7.7.0`) | OK — `prisma.config.ts` required for Prisma 7 |
| @prisma/client | 7.8.0 | OK |
| TypeScript | 5.9.3 | OK |
| ts-node | 10.9.2 | OK with `TS_NODE_TRANSPILE_ONLY=1` (used in npm scripts) |

**Notes:**

- Seeds import `src/infrastructure/db/prismaClient` (Prisma 7 adapter pattern) — requires `prisma generate` before run (`postinstall` / `setup:prisma`).
- Use `node scripts/run-local-prisma.cjs` for CLI — avoids `npx prisma` version mismatch.
- `require('./prisma/seed.ts')` executes `main()` immediately — there is no dry-load guard.

---

## 7. Data preservation summary

When following the production execution plan (skip step 18, skip demo seeds):

| Domain | Preserved |
|--------|-----------|
| Users, wallets, transactions | Yes |
| Organizations, branches | Yes (except campaign anchor opt-in) |
| Clinics, patients, pets | Yes |
| Orders, inventory, stock ledger | Yes |
| Org clinical items (existing) | Yes |
| Master clinical catalog (existing) | Yes **only if step 18 skipped** |

---

## 8. Commands to avoid on production

| Command / file | Reason |
|----------------|--------|
| `npm run db:reset` | Drops entire database |
| `npm run db:seed` / `seed` | Includes step 18 CSV wipe |
| `npm run db:deploy` on populated DB | Runs full seed after migrate |
| `prisma/seeds/seed-master-catalog.ts` | `deleteMany` destructive replacement |
| `scripts/seed-demo-catalog.ts` | Demo products |
| `scripts/seed-test-stock.js` | Injects test inventory |
| `prisma/seed_all.js` | Broken + legacy |
| `SEED_WAREHOUSE_PHASE1=true` | Demo warehouse rows |

---

*Audit complete. No application code was modified.*
