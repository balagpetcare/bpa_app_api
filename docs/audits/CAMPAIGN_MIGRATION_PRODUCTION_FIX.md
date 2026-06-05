# Campaign Migration Production Fix

**Date:** 2026-06-06  
**Project:** `backend-api`  
**Related audit:** `docs/audits/CAMPAIGN_MIGRATION_DEPENDENCY_ANALYSIS.md`

---

## Summary

Production `migrate deploy` failed because `20260603120000_campaign_checkout_session` referenced `campaign_rollout_regions` before `20260604120000_campaign_national_rollout` created it.

**Fix:** Renamed the checkout migration folder (git history preserved) so national rollout runs first. Added repair and clean-deploy validation scripts.

---

## What Changed

| Change | Details |
|--------|---------|
| **Migration rename** | `prisma/migrations/20260603120000_campaign_checkout_session/` → `prisma/migrations/20260604130000_campaign_checkout_session/` |
| **Checkout SQL** | `bookedCount` uses `ADD COLUMN IF NOT EXISTS` (idempotent if column already exists on out-of-order dev DBs) |
| **National rollout** | Unchanged (preserves checksum for any DB that already applied it) |
| **Repair script** | `scripts/repair-campaign-migration-order.mjs` — failed P3018 resolve + applied-metadata rename |
| **Validation script** | `scripts/validate-migrate-deploy-clean.mjs` — full deploy on empty DB |
| **No deletions** | Old folder renamed via `git mv`; SQL content retained with minor idempotent tweak |

---

## Correct Migration Sequence (Campaign Chain)

```text
20260602_add_vaccination_campaign_2026          ← campaign_locations, campaign_bookings
20260603031500_centralized_location_system
20260603120000_campaign_sms_cost_monitoring
20260603140000_payment_transaction_log
20260603180000_campaign_countdown_fields
20260603190000_coverage_zones
20260604010800_add_campaign_config_tables
20260604120000_campaign_national_rollout          ← CREATE campaign_rollout_regions (+ phases, pre_registrations)
20260604130000_campaign_checkout_session          ← CREATE campaign_checkout_sessions; FK to rollout_regions
20260604150000_campaign_booking_coverage_zone
20260604180000_zone_interest_booking
20260604190000_campaign_booking_zone_interest_reconcile
… (remaining June 2026 migrations)
```

**Dependency rule satisfied:** `campaign_rollout_regions` is created in `20260604120000` before any reference in `20260604130000`.

---

## Deployment Instructions

### Pre-flight (all environments)

```bash
node scripts/audit-migration-dependencies.mjs   # expect violationCount: 0
node scripts/check-migration-integrity.js       # before/after per policy
```

### Scenario A — Production failed on old checkout (P3018)

Typical state: `_prisma_migrations` has `20260603120000_campaign_checkout_session` with `finished_at` NULL.

1. **Backup**

   ```bash
   pg_dump "$DATABASE_URL" -Fc -f backup-pre-campaign-fix.dump
   ```

2. **Inspect**

   ```bash
   node scripts/repair-campaign-migration-order.mjs
   ```

3. **Clear failed migration**

   ```bash
   node scripts/repair-campaign-migration-order.mjs --resolve-failed
   # or manually:
   npx prisma migrate resolve --rolled-back 20260603120000_campaign_checkout_session
   ```

4. **Deploy**

   ```bash
   npx prisma migrate deploy
   node scripts/check-migration-integrity.js
   npx prisma migrate status
   ```

5. **Verify objects**

   ```sql
   SELECT to_regclass('public.campaign_rollout_regions');
   SELECT to_regclass('public.campaign_checkout_sessions');
   SELECT column_name FROM information_schema.columns
     WHERE table_name = 'campaign_rollout_regions' AND column_name = 'bookedCount';
   ```

### Scenario B — Dev DB already applied old checkout successfully

Typical state: `20260603120000_campaign_checkout_session` has `finished_at` set; Prisma reports migration “not found locally”.

1. **Rename metadata only** (no DDL re-run)

   ```bash
   node scripts/repair-campaign-migration-order.mjs --rename-applied
   ```

2. **Deploy remaining pending migrations**

   ```bash
   npx prisma migrate deploy
   ```

### Scenario C — Fresh database / new environment

```bash
npx prisma migrate deploy
```

**CI/local validation:**

```bash
node scripts/validate-migrate-deploy-clean.mjs
```

---

## Rollback Plan

This fix is **forward-only** (rename + metadata repair). There is no automatic down-migration.

| Situation | Rollback approach |
|-----------|-------------------|
| **Before deploy** | Revert git commit that renamed the folder; restore old migration name in repo |
| **After deploy on production (Scenario A)** | Restore from `pg_dump` backup taken in step 1. Do **not** use `migrate reset` on production-like DB |
| **After metadata rename (Scenario B)** | Manual SQL: `UPDATE _prisma_migrations SET migration_name = '20260603120000_campaign_checkout_session', checksum = '<old>' WHERE migration_name = '20260604130000_campaign_checkout_session'` — only if matching old checksum on disk from git history |
| **Partial deploy failure** | `prisma migrate resolve --rolled-back <failed_migration>` then fix SQL forward; never edit applied successful migrations |

### Emergency checklist

1. Stop application traffic if schema half-applied.
2. Restore database from backup if data integrity uncertain.
3. Document state in `_prisma_migrations` before any manual SQL.
4. Re-run integrity check after recovery.

---

## Validation Performed

| Check | Result |
|-------|--------|
| `node scripts/audit-migration-dependencies.mjs` | 0 violations |
| `node scripts/validate-migrate-deploy-clean.mjs` | PASS — 271 migrations on empty DB |
| Campaign tables after clean deploy | `campaign_rollout_regions`, `campaign_checkout_sessions`, `campaign_pre_registrations` present |

---

## Files Touched

- `prisma/migrations/20260604130000_campaign_checkout_session/migration.sql` (renamed from `20260603120000_…`)
- `scripts/repair-campaign-migration-order.mjs` (new)
- `scripts/validate-migrate-deploy-clean.mjs` (new)
- `docs/audits/CAMPAIGN_MIGRATION_PRODUCTION_FIX.md` (this file)

---

## Post-merge Checklist

- [ ] Production backup
- [ ] Run repair script for correct scenario (A or B)
- [ ] `npx prisma migrate deploy`
- [ ] `node scripts/check-migration-integrity.js`
- [ ] Smoke-test campaign checkout API
- [ ] Confirm `migrate status` shows no pending migrations
