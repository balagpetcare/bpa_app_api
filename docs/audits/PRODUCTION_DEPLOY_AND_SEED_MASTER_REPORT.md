# Production Deploy and Seed — Master Report (BPA / WPA)

**Date:** 2026-06-06  
**Repository:** `backend-api`  
**Scope:** Analysis only — no code changes  
**Audience:** DevOps, backend leads, production operators

---

## 1. Purpose

This master report consolidates the full BPA/WPA production seed system audit. Detailed evidence lives in linked child documents.

| Document | Contents |
|----------|----------|
| [PRODUCTION_SEED_CLASSIFICATION.md](./PRODUCTION_SEED_CLASSIFICATION.md) | SAFE / WARNING / DANGEROUS per command and per file |
| [PRODUCTION_SEED_EXECUTION_PLAN.md](../plans/PRODUCTION_SEED_EXECUTION_PLAN.md) | Phased production-safe seed order |
| [SUPER_ADMIN_BOOTSTRAP_AUDIT.md](./SUPER_ADMIN_BOOTSTRAP_AUDIT.md) | Admin account creation, env vars, recovery |
| [MIGRATION_AND_SEED_DEPENDENCY_AUDIT.md](./MIGRATION_AND_SEED_DEPENDENCY_AUDIT.md) | migrate deploy vs reset, migration→seed deps |
| [REPOSITORY_SEED_CONSISTENCY_AUDIT.md](./REPOSITORY_SEED_CONSISTENCY_AUDIT.md) | Broken imports, dead paths, deploy risks |
| [SEED_SYSTEM_AUDIT.md](./SEED_SYSTEM_AUDIT.md) | Prior chain inventory |
| [SEED_RECOVERY_PLAN.md](../plans/SEED_RECOVERY_PLAN.md) | Future fixes (not implemented) |

---

## 2. Critical findings

1. **Never run `npm run db:seed` or `db:deploy` on a populated production database.** Step 18 (`prisma/seeds/seed-master-catalog.ts`) deletes all master clinical catalog rows before CSV reload.
2. **Coverage zones are not in the main seed chain.** After deploy, run `npm run seed:coverage-zones` when coverage features are needed.
3. **Super Admin login requires `npm run admin:bootstrap`.** Prisma seed does not create admin users with passwords.
4. **`prisma/seed_all.js` is broken** (missing `seed_social.js`) — do not use.
5. **Stack verified:** Node 22.22.0, Prisma 7.8.0, TypeScript 5.9.3, ts-node 10.9.2 — compatible.

---

## 3. Command classification

### 3.1 SAFE commands

| Command | Use |
|---------|-----|
| `npm run bootstrap:deploy` | Production schema deploy (migrate only) |
| `npm run prisma:migrate:deploy` | Same (migrate only) |
| `npm run setup:prisma` | validate + generate |
| `npm run admin:verify` | Read-only Super Admin check |
| `npm run verify:location-master` | Read-only location check |
| `npm run verify:coverage-zones` | Read-only coverage check |
| Targeted one-liner seeders classified SAFE in classification doc | Missing master rows only |

### 3.2 WARNING commands

| Command | Caution |
|---------|---------|
| `npm run admin:bootstrap` | Resets password for matched admin identity |
| `npm run seed:location-master` | Syncs BD location labels |
| `npm run seed:dhaka-city` | Upserts Dhaka BdArea tree |
| `npm run seed:coverage-zones` | Upserts coverage zones (run after location migration) |
| `npm run seed:dhaka-metro` | Partial metro coverage |
| `npm run seed:clinic-vaccine-items` | Creates org clinical items (`ORG_ID` required) |
| `npm run seed:campaign-checkout-anchor` | May create/update BPA campaign org/branch |
| RBAC one-liner (`seedRolesPermissions` + `seedGlobalCountryRoles`) | Updates role labels; may assign PLATFORM_ADMIN |
| `seedMembershipBackfill` (in full seed) | Overwrites owner membership roles |

### 3.3 DANGEROUS commands

| Command | Reason |
|---------|--------|
| `npm run db:reset` | Drops entire database |
| `npm run db:seed` / `npm run seed` | Includes step 18 catalog wipe |
| `npm run db:deploy` on populated DB | migrate + full seed |
| `prisma/seeds/seed-master-catalog.ts` (step 18) | `deleteMany` on all master clinical catalog |
| `scripts/seed-demo-catalog.ts` | Demo product pollution |
| `scripts/seed-test-stock.js` | Injects test inventory |
| `prisma/seed_all.js` | Broken + legacy |
| `SEED_WAREHOUSE_PHASE1=true` + seed | Demo warehouse on first org |

---

## 4. Exact production deployment order

### Step 1 — Pre-flight

```powershell
cd D:\BPA_Data\backend-api
# Backup database (platform-specific)
npm ci
npm run setup:prisma
node scripts/check-migration-integrity.js
npm run prisma:migrate:status
```

### Step 2 — Deploy schema

```powershell
npm run bootstrap:deploy
```

### Step 3 — Deploy application

Build and restart API per your hosting (PM2, Docker, etc.). Seeds are **not** required for API process start if master data already exists.

### Step 4 — Targeted seeds (existing production)

Follow [PRODUCTION_SEED_EXECUTION_PLAN.md](../plans/PRODUCTION_SEED_EXECUTION_PLAN.md) phases 1–7 as needed. **Skip** full `db:seed`.

### Step 5 — Super Admin

```powershell
cross-env SUPER_ADMIN_EMAIL=admin@yourdomain.com SUPER_ADMIN_PASSWORD="<strong-password>" npm run admin:bootstrap
npm run admin:verify
```

### Step 6 — Smoke tests

- Admin panel login
- Location picker (BD hierarchy)
- Coverage zone booking (if applicable)
- Clinic catalog installer
- POS / inventory read paths unchanged

---

## 5. Exact production seed order (populated DB)

| Phase | Action | Command summary |
|-------|--------|-----------------|
| 0 | Migrate | `npm run bootstrap:deploy` |
| 1 | Location | `seed:location-master` → `seed:dhaka-city` → global location one-liner |
| 2 | Coverage | `npm run seed:coverage-zones` |
| 3 | RBAC | Roles one-liner (see execution plan §Phase 3) |
| 4 | Clinical | `seedMasterClinicalCatalog` + `seedVaccineTypes` — **not** step 18 |
| 5 | Products | Product master chain — **not** demo catalog |
| 6 | Optional reference | Animal taxonomy, countries, vet bodies, org country backfill |
| 7 | Super Admin | `npm run admin:bootstrap` |

Full copy-paste commands: [PRODUCTION_SEED_EXECUTION_PLAN.md](../plans/PRODUCTION_SEED_EXECUTION_PLAN.md).

---

## 6. Super Admin recovery procedure

1. Set `SUPER_ADMIN_EMAIL` or `SUPER_ADMIN_PHONE` (single identity).
2. Set new `SUPER_ADMIN_PASSWORD`.
3. `npm run admin:bootstrap`
4. `npm run admin:verify` — confirm `hasSuperAdminRole: true`, `hasPasswordHash: true`
5. Login with **one** phone/email (not comma-separated env string).

Details: [SUPER_ADMIN_BOOTSTRAP_AUDIT.md](./SUPER_ADMIN_BOOTSTRAP_AUDIT.md).

---

## 7. Production refresh procedure

When releasing new master data without touching business rows:

1. Backup database.
2. `npm run bootstrap:deploy`
3. Run **only** seed phases affected by the release (e.g. new permissions → Phase 3; new coverage → Phase 2).
4. `admin:verify` if auth changed.
5. Smoke test affected features.

**Never** use full `db:seed` as a refresh mechanism on live data.

---

## 8. Recommended rollback plan

| Situation | Action |
|-----------|--------|
| Migration failure mid-deploy | Stop; do not reset prod; fix forward or restore backup |
| Wrong targeted seed (RBAC/location) | Forward-fix or restore affected tables from backup |
| Step 18 accidentally executed | **Full DB restore** — catalog IDs may have changed |
| Wrong admin password after bootstrap | Re-run `admin:bootstrap` with correct password |
| Application regression post-deploy | Roll back application binary; DB unchanged if only migrate succeeded |

**Primary rollback:** Database point-in-time restore from pre-deploy backup.

---

## 9. Fresh database vs existing production

| Scenario | Deploy | Seed |
|----------|--------|------|
| **Empty DB** (first install) | `bootstrap:deploy` | Full `db:seed` acceptable **or** phased plan; `admin:bootstrap` required |
| **Existing production** | `bootstrap:deploy` | Phased plan only; **never** step 18 / full seed |
| **New migration only** | `bootstrap:deploy` | Run affected phase only |

---

## 10. Data preservation guarantee

When operators follow this master report (skip step 18, skip demo/test seeds):

| Preserved |
|-----------|
| Users, wallets, transactions |
| Organizations, branches, clinics |
| Patients, pets, clinical records |
| Orders, inventory, stock ledger |
| Existing org clinical items and custom catalogs |

| Added only |
|------------|
| Missing master/reference rows |
| Missing permissions and role links |
| Missing locations and coverage zones |
| Missing catalog entries (by slug/code, not replace) |

---

## 11. Open risks (require future implementation)

Tracked in [SEED_RECOVERY_PLAN.md](../plans/SEED_RECOVERY_PLAN.md) — not fixed in this audit:

- Step 18 CSV seed should use upsert, not delete-and-reload
- Coverage seeders should be in main chain or deploy checklist automation
- Dedicated `seed:roles` npm script
- `SEED_DEMO_PRODUCTS=false` guard for demo catalog step
- Legacy script cleanup (`seed_all.js`, `seed.js`)

---

## 12. Operator quick reference card

```
✅  npm run bootstrap:deploy
✅  npm run seed:coverage-zones        (after locations)
✅  npm run admin:bootstrap            (with SUPER_ADMIN_* env)
✅  npm run admin:verify

❌  npm run db:reset
❌  npm run db:seed                    (on populated prod)
❌  npm run db:deploy                  (on populated prod)
❌  step 18 / seed-master-catalog.ts
❌  seed-test-stock.js / demo catalog
```

---

*Master report complete. No application code was modified.*
