# Seed System — Production Recovery Plan

**Date:** 2026-06-06  
**Status:** Planning only — **do not implement until approved**  
**Source audit:** [SEED_SYSTEM_AUDIT.md](../audits/SEED_SYSTEM_AUDIT.md)  
**Policy:** Follow [PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md](../PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md) — no `migrate reset`, no `db push` on production DB.

---

## 1. Objectives

| # | Requirement | Current state | Target state |
|---|-------------|---------------|--------------|
| 1 | Broken imports repaired | Main `prisma/seed.ts` chain OK; legacy `seedLocationsDhaka.js` has wrong self-path | Zero broken import paths in any documented entry point |
| 2 | Missing seed references | Coverage zones + admin bootstrap outside `db:seed` | All production-critical reference data reachable from one documented pipeline |
| 3 | `prisma db seed` succeeds | Passes on clean DB (verified 2026-06-06) | Passes on CI + staging + production with gates |
| 4 | Idempotent seeding | Most seeders upsert; **CSV clinical seed is destructive** | Re-runnable without data loss on populated DB |
| 5 | Super Admin creation | User only via `admin:bootstrap`; whitelist optional in seed | Documented + automated post-seed step in deploy runbook |
| 6 | Roles & Permissions | Steps 6 + 15 in `seed.ts` | Verified counts + smoke tests |
| 7 | Bangladesh location master | Steps 1–2 in `seed.ts` | Verified row counts + Dhaka CC codes |
| 8 | Product + clinical catalogs | Steps 9–13, 18–19 | Verified counts; demo products optional in prod |

---

## 2. Gap analysis (from audit)

### 2.1 Not broken (no code repair required for `db:seed`)

- All direct imports in `prisma/seed.ts` resolve.
- `prisma/seed-data/bd.*.json` and `complete_veterinary_master_catalog.csv` exist.
- `prisma/seeders/coverage/**` exists (10 files).

### 2.2 Gaps to close in recovery

| Gap | Severity | Type |
|-----|----------|------|
| Coverage zones not in `prisma/seed.ts` | High (campaign/location) | Missing reference |
| Super Admin **user** not in Prisma seed | High (first login) | Process + optional script wiring |
| `seed-master-catalog.ts` uses `deleteMany` | High (re-seed on prod) | Idempotency |
| `seedDemoMasterProductCatalog` always runs | Medium (prod noise) | Env guard |
| Legacy `prisma/seed.js` / `seedLocationsDhaka.js` | Medium (operator confusion) | Broken path if run manually |
| Stale docs reference `seed.js` / legacy Dhaka | Low | Documentation |
| Duplicate SUPER_ADMIN role logic (`bootstrap` vs `seedGlobalCountryRoles`) | Low | Consolidation |
| No automated seed verification in CI/deploy | Medium | Tooling |

---

## 3. Recovery phases

```text
Phase 0 — Pre-flight (read-only)     migration integrity, backup, env audit
Phase 1 — Code hygiene               legacy imports, docs, env flags
Phase 2 — Idempotency hardening      clinical CSV, optional demo seed
Phase 3 — Pipeline integration       coverage zones, deploy scripts
Phase 4 — Super Admin automation     bootstrap in runbook + optional npm script
Phase 5 — Validation & sign-off      counts, smoke tests, production execution
```

---

## 4. Phase 0 — Pre-flight (before any code change)

### 4.1 Database safety

```bash
cd backend-api
node scripts/check-migration-integrity.js    # must exit 0
npm run prisma:migrate:status                  # no pending failed migrations
```

- Take **DB snapshot** before first production re-seed on a non-empty database.
- Record current row counts for: `roles`, `permissions`, `bd_divisions`, `master_clinical_catalog_*`, `master_product_catalog`, `coverage_zones`.

### 4.2 Environment audit (production `.env`)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `DATABASE_URL` | All seeds | Production Postgres |
| `SUPER_ADMIN_WHITELIST_EMAILS` | Step 7 whitelist | Comma-separated |
| `SUPER_ADMIN_WHITELIST_PHONES` | Step 7 whitelist | Optional |
| `SUPER_ADMIN_EMAIL` | `admin:bootstrap` | Primary admin |
| `SUPER_ADMIN_PASSWORD` | `admin:bootstrap` | Vault secret |
| `SUPER_ADMIN_NAME` | `admin:bootstrap` | Display name |
| `ADMIN_EMAILS` / `ADMIN_USER_IDS` | `seedGlobalCountryRoles` | Optional role assignment |
| `SEED_DEMO_PRODUCTS` | **Planned** | `false` in prod (not implemented yet) |
| `SEED_COVERAGE_ZONES` | **Planned** | `true` to include coverage in main seed |
| `SEED_INBOUND_RECEIVE_QA` | QA only | Must be unset in prod |
| `SEED_WAREHOUSE_PHASE1` | Demo only | Must be unset in prod |

### 4.3 Baseline validation (current codebase)

```bash
npm ci
npm run prisma:generate
npm run db:seed                    # or: node scripts/run-local-prisma.cjs db seed
```

Capture stdout; expect exit 0. If fail, attach error to recovery ticket before Phase 1.

---

## 5. Phase 1 — Repair broken imports & references

**Goal:** Every documented seed entry point resolves; no orphan broken requires.

### 5.1 Task 1.1 — Legacy runner cleanup

| Action | File(s) | Approach |
|--------|---------|----------|
| Fix or remove broken self-require | `prisma/seeders/seedLocationsDhaka.js` L4–5 | **Option A:** Delete file + redirect comments to `dhaka/runDhakaCitySeed`. **Option B:** Fix path to `require('./seedLocationsDhaka')` and add deprecation header. |
| Deprecate legacy entry | `prisma/seed.js`, `prisma/seed_all.js`, `prisma/seed_location.js` | Replace body with `console.error` pointing to `npm run db:seed`, or thin delegate to `prisma/seed.ts` via child_process |
| Archive duplicate | `prisma/seeders/seedAnimalTypesAndBreeds.ts` | Mark `@deprecated` in file header; reference `seedAnimalTaxonomy.ts` |

**Touch points:** 4–6 files (legacy only; **no change** to `prisma/seed.ts` imports).

### 5.2 Task 1.2 — Wire missing production references

| Action | File(s) | Approach |
|--------|---------|----------|
| Add coverage zones to main seed (opt-in) | `prisma/seed.ts`, `prisma/seeders/index.ts` | After step 2 (Dhaka BdArea), call `runCoverageZoneSeed(prisma)` when `process.env.SEED_COVERAGE_ZONES === 'true'` |
| Export coverage from index | `prisma/seeders/index.ts` | Already exports `runCoverageZoneSeed` — document + use from `seed.ts` |
| Post-deploy script | `package.json`, new `scripts/deploy-seed-production.mjs` | Orchestrate: `migrate deploy` → `db seed` → `seed:coverage-zones` (if not inlined) → `admin:bootstrap` |

**Default production recommendation:** `SEED_COVERAGE_ZONES=true` in production `.env` so `db:deploy` is sufficient for campaign stack.

### 5.3 Task 1.3 — Documentation repair

| File | Change |
|------|--------|
| `README.md` | Replace `node prisma/seed.js` with `npm run db:seed` |
| `docs/coverage-zones/01-analysis.md` §7 | Remove false claim about legacy `seedLocationsDhaka` in main seed |
| `docs/DEPLOYMENT_CHECKLIST_FINAL.md` | Add `admin:bootstrap` after `db:seed` |
| `docs/deployment/BPA_PRODUCTION_DEPLOYMENT_PLAN.md` | Align API deploy with seed recovery runbook (§8) |

---

## 6. Phase 2 — Idempotent seeding

**Goal:** `npm run db:seed` safe to re-run on production without wiping operator-customized master data.

### 6.1 Current idempotency profile

| Seeder | Pattern | Re-run safe? |
|--------|---------|--------------|
| `seedRolesPermissions` | `upsert` | Yes |
| `seedGlobalCountryRoles` | `upsert` | Yes |
| `seedBaseBdLocations` | `upsert` by `code` | Yes |
| `runDhakaCitySeed` | `upsert` by `code` | Yes |
| `runCoverageZoneSeed` | `upsert` by `slug` | Yes |
| `seedBranchTypes`, `seedOrganizationTypes` | `upsert` | Yes |
| Product stack (9–13) | `upsert` / skip-if-exists | Yes |
| `seedMasterClinicalCatalog` | `upsert` by slug | Yes |
| **`seedMasterCatalog` (CSV)** | **`deleteMany` then `create`** | **No** — wipes all master clinical categories/items |

### 6.2 Task 2.1 — Make clinical CSV seed idempotent

**File:** `prisma/seeds/seed-master-catalog.ts`

| Current | Target |
|---------|--------|
| `deleteMany` on items + categories | `upsert` by `slug` (categories) and `(categoryId, itemCode)` or `slug` (items) |
| Full replace every run | Merge strategy: insert missing, update known fields, **do not delete** rows absent from CSV unless `SEED_MASTER_CATALOG_REPLACE=true` |

**Env flags (planned):**

```bash
SEED_MASTER_CATALOG_REPLACE=false   # default — upsert only
SEED_MASTER_CATALOG_REPLACE=true    # explicit full replace (staging reset only)
```

**Risk:** Orgs with `clinicalItem` rows linked to master catalog IDs may break if IDs change during delete/recreate. Upsert-by-slug preserves IDs.

### 6.3 Task 2.2 — Gate demo product seed

**File:** `prisma/seed.ts` step 13.1

```typescript
if (process.env.SEED_DEMO_PRODUCTS !== 'false') {
  await seedDemoMasterProductCatalog(prisma);
}
```

Production `.env`: `SEED_DEMO_PRODUCTS=false`.

### 6.4 Task 2.3 — Idempotency test script (new)

**File:** `scripts/verify-seed-idempotency.mjs` (planned)

1. Run `db:seed` twice in sequence on staging DB.
2. Compare row counts before/after second run (must be stable).
3. Exit 1 if clinical catalog item count drops on second run.

---

## 7. Phase 3 — Ensure `prisma db seed` succeeds end-to-end

### 7.1 Canonical command chain

```bash
npm ci
npm run setup:prisma          # validate + generate
node scripts/check-migration-integrity.js
npm run prisma:migrate:deploy
npm run db:seed
```

### 7.2 Planned `package.json` scripts

| Script | Purpose |
|--------|---------|
| `seed:verify` | Row-count + FK checks (new `scripts/verify-seed.ts`) |
| `deploy:seed` | `migrate deploy && db seed && seed:verify` |
| `deploy:seed:full` | `deploy:seed` + conditional `admin:bootstrap` |

### 7.3 `scripts/verify-seed.ts` (planned) — minimum assertions

| Domain | Query / check |
|--------|----------------|
| Roles & permissions | `permission.count > 50`, `role.count > 5` |
| Super Admin role | `role.findUnique({ key: 'SUPER_ADMIN' })` exists |
| Bangladesh | `bdDivision.count === 8`, `bdDistrict.count >= 64` |
| Dhaka | `bdArea.findUnique({ code: 'CC-DNCC' })` exists |
| Branch / org types | `branchType.count >= 10`, `organizationType.count >= 5` |
| Countries | `country.findUnique({ code: 'BD' })` active |
| Product catalog | `category.count > 0`, `masterProductCatalog.count > 0` |
| Clinical catalog | `masterClinicalCatalogCategory.count > 0`, items > 0 |
| Vaccine types | `vaccineType.count >= 8` |
| Coverage (if enabled) | `coverageZone.count > 0` |

Exit non-zero if any P0 check fails.

### 7.4 CI gate (planned)

Add to PR / release pipeline:

```bash
npm run db:seed
npm run seed:verify
```

Use ephemeral Postgres service container; no production DB.

---

## 8. Phase 4 — Super Admin creation

Super Admin requires **three layers** (audit §6.3). Recovery must automate layers 2–3 in deploy runbook.

### 8.1 Layer map

| Layer | Mechanism | When |
|-------|-----------|------|
| RBAC matrix | `seedRolesPermissions` + `seedGlobalCountryRoles` | During `db:seed` |
| Whitelist | `seedSuperAdminWhitelist` + bootstrap `ensureWhitelist` | Seed (env) + bootstrap |
| User account | `scripts/bootstrap-super-admin.ts` | **After** `db:seed` |

### 8.2 Production bootstrap command

```bash
# After db:seed — requires vault secrets
SUPER_ADMIN_EMAIL=admin@bangladeshpetassociation.com \
SUPER_ADMIN_PASSWORD='<from-vault>' \
SUPER_ADMIN_WHITELIST_EMAILS=admin@bangladeshpetassociation.com \
npm run admin:bootstrap

npm run admin:verify
```

### 8.3 Planned code improvements (optional)

| Task | File | Benefit |
|------|------|---------|
| Unify `SUPER_ADMIN` role creation | `bootstrap-super-admin.ts`, `seedGlobalCountryRoles.ts` | Single source for `global.admin` permission |
| `deploy:seed:full` script | `scripts/deploy-seed-production.mjs` | One command for ops; bootstrap only if `RUN_ADMIN_BOOTSTRAP=true` |
| Never run bootstrap inside `prisma/seed.ts` | — | Avoids password in Prisma seed logs |

### 8.4 Acceptance criteria — Super Admin

- [ ] `User` row exists with `UserGlobalRole` → `SUPER_ADMIN`
- [ ] `SuperAdminWhitelist` row active for admin email/phone
- [ ] `GET /api/v1/admin/auth/me` returns 200 with valid session cookie after login on admin panel
- [ ] `admin:verify` exits 0

---

## 9. Phase 5 — Domain-specific recovery steps

### 9.1 Roles & Permissions

**Seeders:** `seedRolesPermissions` (step 6) → `seedGlobalCountryRoles` (step 15)

**Recovery actions:**

1. Confirm no manual DB edits to `roles` / `permissions` on production.
2. Re-run `db:seed` (idempotent upsert).
3. Verify `PRODUCER_STAFF`, `OWNER`, `BRANCH_MANAGER`, `SUPER_ADMIN` keys exist.
4. Run `npm run backfill:branch-access` only if branch permission matrix changed (separate from seed).

**Order constraint:** Must run **before** `admin:bootstrap` (bootstrap assigns `SUPER_ADMIN` role by ID).

### 9.2 Bangladesh master location data

**Seeders:** `seedBaseBdLocations` (step 1) → `runDhakaCitySeed` (step 2)

**Data files (must ship in repo):**

- `prisma/seed-data/bd.divisions.json`
- `prisma/seed-data/bd.districts.json`
- `prisma/seed-data/bd.upazilas.json`
- `prisma/seed-data/bd.areas.json`

**Recovery actions:**

1. If step 1 skipped (missing JSON), seed logs `⚠️ seedBaseBdLocations skipped` — fix deployment artifact (ensure `prisma/seed-data` copied to server).
2. Run standalone: `npm run seed:location-master` then `npm run seed:dhaka-city`.
3. Verify: `npm run verify:location-master` (if exists) or manual counts.

**Expected counts (approximate):** 8 divisions, 64 districts, 495 upazilas, 4500+ union/area rows, DNCC+DSCC area codes present.

### 9.3 Coverage zones (if campaign enabled)

**Not in current `db:seed`** — add via Phase 1.2 or manual:

```bash
npm run seed:coverage-zones
npm run verify:coverage-zones
```

**Prerequisite:** `CC-DNCC` exists in `bd_areas` (step 2 or `seed:dhaka-city`).

### 9.4 Product catalog

**Seeders:** steps 9 → 10 → 11 → 12 → 13 → (optional 13.1)

**Recovery actions:**

1. Set `SEED_DEMO_PRODUCTS=false` in production (after Phase 2.2 implemented).
2. Re-run `db:seed`.
3. Verify `master_product_catalog` count > 0; brands and categories populated.
4. `bd_pet_products_master_catalog.csv` is **API export only** — not loaded by seed (no action).

### 9.5 Clinical catalog

**Seeders:** step 17 (per-org, no-op on empty DB) → step 18 (CSV) → step 19 (TS templates)

**Data:**

- `prisma/seed-data/complete_veterinary_master_catalog.csv`
- `prisma/seeders/data/masterClinicalCatalog*.ts`

**Recovery actions:**

1. Implement Phase 2.1 before re-seeding production with existing clinics (avoid `deleteMany`).
2. Until then: **only run step 18 on fresh DB** or accept master catalog wipe.
3. Verify: categories > 0, items > 1000, templates > 0.
4. Per-org vaccine line items: `ORG_ID=<id> npm run seed:clinic-vaccine-items` after org created (not part of global seed).

**Order constraint:** Step 18 before 19 (TS seed merges with CSV slugs).

### 9.6 Vaccine catalog (global types)

**Seeder:** `seedVaccineTypes` (step 20) — upsert by `name`.

Re-run safe. Verify Rabies, DHPP, FVRCP exist.

---

## 10. Production execution runbook

### 10.1 Fresh production database (recommended path)

```bash
# 1. Backup / snapshot (even on fresh — habit)
# 2. Migrations
cd /opt/bpa/backend-api
git pull origin main
npm ci
node scripts/check-migration-integrity.js
npm run prisma:migrate:deploy

# 3. Reference data seed
export SEED_DEMO_PRODUCTS=false
export SEED_COVERAGE_ZONES=true          # after Phase 1.2 implemented
export SEED_MASTER_CATALOG_REPLACE=false # after Phase 2.1 implemented
export SUPER_ADMIN_WHITELIST_EMAILS=admin@bangladeshpetassociation.com
npm run db:seed

# 4. Verify seed
npm run seed:verify                      # after Phase 3 implemented

# 5. Coverage (if not inlined in seed.ts)
npm run seed:coverage-zones
npm run verify:coverage-zones

# 6. Super Admin user (first time only)
export SUPER_ADMIN_EMAIL=admin@bangladeshpetassociation.com
export SUPER_ADMIN_PASSWORD='<vault>'
npm run admin:bootstrap
npm run admin:verify

# 7. Restart API
pm2 restart bpa-api bpa-worker
```

### 10.2 Existing production database (re-seed reference data)

**Warning:** Step 18 (`seed-master-catalog`) is destructive until Phase 2.1 is implemented.

| Safe to re-run today | Risky on populated DB |
|----------------------|------------------------|
| Roles, permissions, branch/org types, countries, BD locations, Dhaka areas, vaccine types, product upserts | CSV clinical catalog wipe |

**Procedure:**

1. DB snapshot mandatory.
2. Run `db:seed` only after Phase 2.1 merged **OR** temporarily comment step 18 in `seed.ts` on hotfix branch (not recommended — use upsert fix instead).
3. Run `admin:bootstrap` — idempotent (updates existing user password if env set).

### 10.3 Rollback

| Failure | Action |
|---------|--------|
| Seed fails mid-chain | Fix error; re-run `db:seed` (upsert-safe seeders recover). Do **not** `migrate reset`. |
| Clinical catalog wiped | Restore DB snapshot |
| Admin bootstrap wrong password | Re-run `admin:bootstrap` with correct `SUPER_ADMIN_PASSWORD` |

---

## 11. Implementation backlog (ordered)

| ID | Task | Files | Priority | Blocks |
|----|------|-------|----------|--------|
| R1 | Upsert-based `seed-master-catalog.ts` + `SEED_MASTER_CATALOG_REPLACE` | `prisma/seeds/seed-master-catalog.ts` | P0 | Prod re-seed |
| R2 | `SEED_DEMO_PRODUCTS` guard | `prisma/seed.ts` | P1 | Prod cleanliness |
| R3 | `SEED_COVERAGE_ZONES` in `seed.ts` | `prisma/seed.ts` | P1 | Campaign deploy |
| R4 | `scripts/verify-seed.ts` + `npm run seed:verify` | new script, `package.json` | P1 | Sign-off |
| R5 | `scripts/deploy-seed-production.mjs` | new script, `package.json` | P1 | Ops automation |
| R6 | Legacy seed cleanup / deprecation | `prisma/seed.js`, `seedLocationsDhaka.js`, etc. | P2 | Confusion |
| R7 | Doc updates | README, coverage-zones analysis, deploy checklist | P2 | Operator error |
| R8 | CI seed + verify job | `.github/workflows` or equivalent | P2 | Regression |
| R9 | Consolidate SUPER_ADMIN role definition | bootstrap + seedGlobalCountryRoles | P3 | Maintainability |
| R10 | `scripts/verify-seed-idempotency.mjs` | new script | P3 | QA |

**Estimated touch points (implementation):** 8–12 files, 0 schema migrations if upsert-only.

---

## 12. Acceptance checklist (sign-off)

### 12.1 `prisma db seed`

- [ ] `npm run db:seed` exits 0 on empty DB after `migrate deploy`
- [ ] `npm run db:seed` exits 0 on second run (idempotency)
- [ ] No `Cannot find module` errors
- [ ] `seed:verify` passes all P0 assertions

### 12.2 Super Admin

- [ ] `SUPER_ADMIN` role exists after seed
- [ ] Whitelist populated when env set
- [ ] `admin:bootstrap` creates/updates user
- [ ] Admin panel login works

### 12.3 Roles & Permissions

- [ ] ORG/BRANCH roles and permission matrix present
- [ ] GLOBAL/COUNTRY roles present (`seedGlobalCountryRoles`)

### 12.4 Bangladesh locations

- [ ] National hierarchy seeded from JSON
- [ ] `CC-DNCC`, `CC-DSCC`, `AREA-DNCC-*` rows exist

### 12.5 Catalogs

- [ ] Master product catalog populated (without demo if `SEED_DEMO_PRODUCTS=false`)
- [ ] Master clinical catalog populated from CSV + TS
- [ ] `vaccineType` rows present

### 12.6 Coverage (if campaign live)

- [ ] `coverage_zones` and mappings populated
- [ ] `verify:coverage-zones` exits 0

---

## 13. Out of scope (this recovery)

- `db:reset` / `migrate reset` on production
- Per-org `seed:clinic-vaccine-items` (run after org onboarding)
- `seed:campaign-checkout-anchor` (campaign-specific)
- Schema changes to seed-related models
- Seeding via API startup hook (anti-pattern)

---

## 14. Related documents

| Document | Purpose |
|----------|---------|
| [SEED_SYSTEM_AUDIT.md](../audits/SEED_SYSTEM_AUDIT.md) | As-is analysis |
| [PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md](../PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md) | DB safety |
| [DEPLOYMENT_CHECKLIST_FINAL.md](../DEPLOYMENT_CHECKLIST_FINAL.md) | API deploy |
| [CLINIC_MASTER_CATALOG.md](../CLINIC_MASTER_CATALOG.md) | Clinical CSV |
| [coverage-zones/01-analysis.md](../coverage-zones/01-analysis.md) | Coverage design |

---

**Next step:** Review and approve Phase 1–2 implementation order (R1–R3) before any production re-seed on a non-empty database.
