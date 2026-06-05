# VPS Deployment Steps After Campaign Migration Fix

**Date:** 2026-06-06  
**Project:** `backend-api` (API port **3000** — do not change)  
**Commit message:** `fix(prisma): resolve campaign rollout migration dependency ordering`

---

## Pre-deploy verification (completed in CI/local)

| Check | Command | Expected |
|-------|---------|----------|
| Build | `npm run build` | Exit 0 |
| Schema | `npx prisma validate` | Valid |
| Migration order | `node scripts/audit-migration-dependencies.mjs` | `violationCount: 0` |
| Fresh DB replay | `node scripts/validate-migrate-deploy-clean.mjs` | PASS — 271 migrations |

Campaign chain order on fresh DB:

```text
20260604120000_campaign_national_rollout   → CREATE campaign_rollout_regions
20260604130000_campaign_checkout_session   → FK to campaign_rollout_regions
```

---

## VPS deployment (production — Scenario A: failed P3018)

Typical VPS state: deploy stopped on `20260603120000_campaign_checkout_session` with `relation "campaign_rollout_regions" does not exist`.

### 1. SSH and enter app directory

```bash
ssh user@your-vps
cd /path/to/backend-api   # e.g. /var/www/backend-api
```

### 2. Backup database (mandatory)

```bash
source .env   # or export DATABASE_URL from your secrets manager
pg_dump "$DATABASE_URL" -Fc -f ~/backup-pre-campaign-migration-$(date +%Y%m%d-%H%M).dump
ls -lh ~/backup-pre-campaign-migration-*.dump
```

### 3. Pull fix from main

```bash
git fetch origin
git checkout main
git pull origin main
```

### 4. Install dependencies and build

```bash
npm ci
npm run build
npx prisma validate
```

### 5. Repair failed migration metadata

```bash
node scripts/repair-campaign-migration-order.mjs
```

If output shows **failed checkout (P3018)**:

```bash
node scripts/repair-campaign-migration-order.mjs --resolve-failed
```

Equivalent manual command:

```bash
npx prisma migrate resolve --rolled-back 20260603120000_campaign_checkout_session
```

### 6. Apply migrations

```bash
node scripts/check-migration-integrity.js
npx prisma migrate deploy
node scripts/check-migration-integrity.js
npx prisma migrate status
```

Expected: `Database schema is up to date!`

### 7. Verify campaign schema

```bash
psql "$DATABASE_URL" -c "SELECT to_regclass('public.campaign_rollout_regions');"
psql "$DATABASE_URL" -c "SELECT to_regclass('public.campaign_checkout_sessions');"
psql "$DATABASE_URL" -c "SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '%checkout%' OR migration_name LIKE '%national_rollout%';"
```

### 8. Restart API

Use your existing process manager (example with PM2):

```bash
pm2 restart backend-api
# or: systemctl restart backend-api
```

### 9. Smoke test

```bash
curl -sS http://127.0.0.1:3000/api/v1/health
# Exercise campaign checkout endpoint if available
```

---

## VPS deployment (Scenario B: old checkout already applied)

If `20260603120000_campaign_checkout_session` has `finished_at` set and Prisma reports migration not found locally:

```bash
git pull origin main
npm ci && npm run build
node scripts/repair-campaign-migration-order.mjs --rename-applied
npx prisma migrate deploy
node scripts/check-migration-integrity.js
pm2 restart backend-api
```

No checkout DDL is re-run; only `_prisma_migrations` metadata is renamed to `20260604130000_campaign_checkout_session`.

---

## One-liner reference (Scenario A)

```bash
cd /path/to/backend-api && \
pg_dump "$DATABASE_URL" -Fc -f ~/backup-pre-campaign-$(date +%Y%m%d).dump && \
git pull origin main && \
npm ci && npm run build && \
node scripts/repair-campaign-migration-order.mjs --resolve-failed && \
node scripts/check-migration-integrity.js && \
npx prisma migrate deploy && \
node scripts/check-migration-integrity.js && \
npx prisma migrate status && \
pm2 restart backend-api
```

---

## Rollback

1. Stop API: `pm2 stop backend-api`
2. Restore backup: `pg_restore -d "$DATABASE_URL" --clean --if-exists ~/backup-pre-campaign-YYYYMMDD.dump`
3. Checkout previous git commit on VPS (only if no successful migrate deploy yet)
4. Do **not** run `prisma migrate reset` on production-like DB

See `docs/audits/CAMPAIGN_MIGRATION_PRODUCTION_FIX.md` for full rollback matrix.

---

## Related docs

- `docs/audits/CAMPAIGN_MIGRATION_DEPENDENCY_ANALYSIS.md` — root cause audit
- `docs/audits/CAMPAIGN_MIGRATION_PRODUCTION_FIX.md` — fix details and scenarios
- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` — migration policy

---

## Post-deploy checklist

- [ ] Backup file exists and is non-zero size
- [ ] `migrate status` — up to date
- [ ] `check-migration-integrity.js` — no drift
- [ ] `campaign_rollout_regions` and `campaign_checkout_sessions` exist
- [ ] API health check returns 200
- [ ] Campaign booking/checkout smoke test passed
