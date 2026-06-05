# Campaign Checkout Reconciliation Plan

**Date:** 2026-06-06  
**Project:** `backend-api`  
**Migration:** `20260604130000_campaign_checkout_session`  
**Production error:** `ERROR: type "CampaignCheckoutStatus" already exists`

---

## Root cause

The original migration `20260603120000_campaign_checkout_session` failed on:

```sql
ALTER TABLE "campaign_rollout_regions" ...
```

because `campaign_rollout_regions` did not exist yet (ordering bug — fixed by rename to `20260604130000`).

**Partial apply:** PostgreSQL created `CampaignCheckoutStatus` on the first statement **before** the migration transaction failed. After `migrate resolve --rolled-back` on the old name, the enum remained in the database but `_prisma_migrations` did not record a successful checkout migration.

Re-running the renamed migration failed on:

```sql
CREATE TYPE "CampaignCheckoutStatus" AS ENUM (...)
```

---

## Migration audit (`20260604130000_campaign_checkout_session`)

| Step | Object | Original DDL | Partial-apply risk |
|------|--------|--------------|------------------|
| 1 | Enum | `CampaignCheckoutStatus` | **YES — confirmed on VPS** |
| 2 | Column | `campaign_rollout_regions.bookedCount` | Possible if failure was later |
| 3 | Columns | `campaign_bookings.rolloutRegionId`, `checkoutSessionId`, `ownerAlternatePhone` | Unlikely (failed before rollout_regions existed on first run) |
| 4 | Table | `campaign_checkout_sessions` | Unlikely |
| 5 | Indexes | 5 indexes on bookings / checkout_sessions | Unlikely |
| 6 | FKs | 5 foreign keys | Unlikely |

### Objects the migration creates (complete set)

**Enums**

- `CampaignCheckoutStatus` → `PENDING`, `PAID`, `FULFILLED`, `EXPIRED`, `FAILED`

**Tables**

- `campaign_checkout_sessions`

**Columns**

- `campaign_rollout_regions.bookedCount`
- `campaign_bookings.rolloutRegionId`
- `campaign_bookings.checkoutSessionId`
- `campaign_bookings.ownerAlternatePhone`

**Indexes**

- `campaign_bookings_rolloutRegionId_idx`
- `campaign_bookings_checkoutSessionId_key` (unique)
- `campaign_checkout_sessions_ownerPhone_idx`
- `campaign_checkout_sessions_status_expiresAt_idx`
- `campaign_checkout_sessions_campaignId_idx`

**Constraints**

- `campaign_bookings_rolloutRegionId_fkey`
- `campaign_bookings_checkoutSessionId_fkey`
- `campaign_checkout_sessions_campaignId_fkey`
- `campaign_checkout_sessions_rolloutRegionId_fkey`
- `campaign_checkout_sessions_orderId_fkey`

---

## Production-safe strategy (implemented)

**Do not drop tables or enums on production.**

| Approach | Used? | Rationale |
|----------|-------|-----------|
| Idempotent migration SQL | **Yes** | Edit pending/failed migration; all DDL guarded |
| `migrate resolve --rolled-back` | **Yes** | Clear P3018 on failed `20260604130000` row before redeploy |
| `migrate resolve --applied` without inspect | No | Risky if schema incomplete |
| Drop `CampaignCheckoutStatus` | **Never** | Destructive; may break dependent objects |
| New reconciliation migration | No | Same migration still pending; idempotent edit is cleaner |

### Idempotent guards applied

- Enum: `DO $$ … EXCEPTION WHEN duplicate_object`
- Columns: `ADD COLUMN IF NOT EXISTS`
- Table: `CREATE TABLE IF NOT EXISTS`
- Indexes: `CREATE INDEX IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`
- FKs: `DO $$ IF NOT EXISTS (pg_constraint …)`

---

## VPS inspection (before deploy)

```bash
cd /path/to/backend-api
node scripts/inspect-campaign-checkout-objects.mjs
```

Expected partial state on affected VPS:

```text
YES  CampaignCheckoutStatus
NO   campaign_checkout_sessions
NO   campaign_bookings.rolloutRegionId
…
Checkout migration marked applied: NO
```

---

## VPS deployment commands

### 1. Backup

```bash
pg_dump "$DATABASE_URL" -Fc -f ~/backup-pre-checkout-reconcile-$(date +%Y%m%d).dump
```

### 2. Pull fix

```bash
git pull origin main
npm ci
npm run build
npx prisma validate
```

### 3. Inspect partial state

```bash
node scripts/inspect-campaign-checkout-objects.mjs
node scripts/repair-campaign-migration-order.mjs
```

### 4. Clear failed migration lock (if P3018 on new name)

```bash
node scripts/repair-campaign-migration-order.mjs --resolve-failed-new
# equivalent:
npx prisma migrate resolve --rolled-back 20260604130000_campaign_checkout_session
```

### 5. Deploy (idempotent SQL completes missing objects)

```bash
node scripts/check-migration-integrity.js
npx prisma migrate deploy
node scripts/check-migration-integrity.js
npx prisma migrate status
```

### 6. Verify

```bash
node scripts/inspect-campaign-checkout-objects.mjs
pm2 restart backend-api
curl -sS http://127.0.0.1:3000/api/v1/health
```

### One-liner (after backup)

```bash
cd /path/to/backend-api && \
git pull origin main && npm ci && \
node scripts/repair-campaign-migration-order.mjs --resolve-failed-new && \
npx prisma migrate deploy && \
node scripts/inspect-campaign-checkout-objects.mjs && \
pm2 restart backend-api
```

---

## Rollback plan

| Step | Action |
|------|--------|
| 1 | Stop API |
| 2 | Restore `pg_dump` backup if deploy fails or schema inconsistent |
| 3 | Do **not** `DROP TYPE CampaignCheckoutStatus` unless restoring full backup |
| 4 | If only metadata wrong: `migrate resolve --rolled-back 20260604130000_campaign_checkout_session` and re-inspect |

---

## Validation performed

| Scenario | Script | Expected |
|----------|--------|----------|
| Fresh database | `validate-campaign-checkout-reconcile.mjs` scenario 1 | All objects + migration applied |
| Partial (enum only) | scenario 2 | Redeploy succeeds, objects complete |
| Failed metadata (P3018) | scenario 3 | resolve + deploy succeeds |

Local run:

```bash
node scripts/validate-campaign-checkout-reconcile.mjs
node scripts/audit-migration-dependencies.mjs
```

---

## Related docs

- `docs/audits/CAMPAIGN_MIGRATION_DEPENDENCY_ANALYSIS.md`
- `docs/audits/CAMPAIGN_MIGRATION_PRODUCTION_FIX.md`
- `docs/audits/VPS_DEPLOYMENT_STEPS_AFTER_MIGRATION_FIX.md`
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`

---

## Files changed in this fix

- `prisma/migrations/20260604130000_campaign_checkout_session/migration.sql` — idempotent DDL
- `scripts/inspect-campaign-checkout-objects.mjs` — VPS object audit
- `scripts/validate-campaign-checkout-reconcile.mjs` — fresh / partial / failed validation
- `scripts/repair-campaign-migration-order.mjs` — `--resolve-failed-new` for P3018 on new name
