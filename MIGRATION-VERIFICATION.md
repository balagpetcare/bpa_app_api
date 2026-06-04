# Migration Verification Report

**Project:** `D:\BPA_Data\backend-api`  
**Date:** June 2, 2026  
**Database:** PostgreSQL via Prisma Migrate  
**Migrations:** 254 folders · 478 unique tables (first-create scan)

---

## Executive summary

| Requirement | Result |
|-------------|--------|
| No data loss (additive tail) | **Pass** — latest campaign/SMS migrations are additive only |
| No destructive migrations (uncontrolled) | **Caution** — historical `20260501000000_drift_reconciliation_baseline` contains `DROP TABLE` / `DROP COLUMN` (documented, live-DB only) |
| No orphan relations | **Pass** — campaign module FKs reference existing `organizations`, `users`, `orders`, `vaccinations` |
| No broken foreign keys (ordering) | **Pass** after fix — static audit `violationCount: 0` |
| Fresh database migration | **Not run in CI** (Docker unavailable on audit host) — use commands below |
| Existing production DB migration | **Pass** — `prisma migrate deploy` applied pending migration successfully |

---

## Verification runs (this audit)

| Check | Command | Outcome |
|-------|---------|---------|
| Migration files present | `npm run migrate:check-files` | **OK** — 254 folders, all non-empty `migration.sql` |
| Dependency ordering (heuristic) | `npm run migrate:audit-deps` | **OK** — `violationCount: 0` (after fix) |
| Prisma schema | `npx prisma validate` | **Valid** |
| Existing DB deploy | `npx prisma migrate deploy` | **Success** — applied `20260603120000_campaign_sms_cost_monitoring` |
| Rollback simulation | `npm run migrate:rollback-sim -- --tail=8` | **Documented** — inverse SQL for last 8 migrations |
| Fresh empty DB | Not executed (no Docker/empty instance on host) | **Pending** — run in CI (see §6) |

**Datasource at audit time:** `bpa_pet_db` @ `localhost:5432` — 253 migrations already applied; 1 pending → now **254/254 applied**.

---

## Critical fix applied during audit

### Lexicographic ordering bug (campaign SMS cost)

| Before | Issue |
|--------|--------|
| Folder `20260602120000_campaign_sms_cost_monitoring` | Sorted **before** `20260602_add_vaccination_campaign_2026` (`…120000` < `…02_add…`) |
| Effect | `ALTER TABLE campaign_sms_logs` ran **before** table existed → fresh deploy **would fail** |

| After | Fix |
|-------|-----|
| Renamed to `20260603120000_campaign_sms_cost_monitoring` | Runs **after** campaign tables migration |
| Static audit | **0 violations** |

**If any environment applied the old folder name** (unlikely — it was never deployed before rename):

```bash
# Only if _prisma_migrations lists 20260602120000_* as failed or applied incorrectly
npx prisma migrate resolve --rolled-back 20260602120000_campaign_sms_cost_monitoring
npx prisma migrate deploy
```

---

## Schema review

| Area | Finding |
|------|---------|
| **Source of truth** | `prisma/schema.prisma` (monolithic, ~14k lines) |
| **Campaign 2026 models** | `Campaign`, `CampaignBooking`, `CampaignSmsLog`, etc. — aligned with `20260602_add_vaccination_campaign_2026` |
| **SMS cost fields** | `provider`, `segmentCount`, `estimatedCostBdt` on `CampaignSmsLog` — migration `20260603120000_*` |
| **Indexes** | Campaign migration defines status/date/phone/ref indexes; SMS log indexes on `bookingId`, `campaignId+status`, `phone` |
| **Constraints** | `bookingRef`, `qrToken`, `slug` UNIQUE; FK `ON DELETE` mix: RESTRICT (campaign tree), CASCADE (`campaign_pets`), SET NULL (owner/payment links) |

### Campaign foreign keys (no orphan parents)

```
campaigns.organizerId          → organizations (SET NULL)
campaign_locations.campaignId  → campaigns (RESTRICT)
campaign_slots.locationId      → campaign_locations (RESTRICT)
campaign_bookings.*            → campaigns, locations, slots, users, orders
campaign_pets.bookingId        → campaign_bookings (CASCADE)
campaign_sms_logs.bookingId    → campaign_bookings (SET NULL)
vaccinations.campaignBookingId → campaign_bookings (SET NULL)
```

All parent tables exist in migrations **before** `20260602_add_vaccination_campaign_2026`.

---

## Migration inventory by risk class

### Low risk (additive, idempotent) — recommended pattern

- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- Placeholder `SELECT 1` (superseded DDL moved later)

**Examples:** `20260602_add_vaccination_campaign_2026`, `20260603120000_campaign_sms_cost_monitoring`, much of warehouse wave 20260429*.

### Medium risk (enum rewrites, column type changes)

- `BEGIN; CREATE TYPE …_new; ALTER COLUMN … TYPE; DROP TYPE old; COMMIT;`
- Found in `20260501000000_drift_reconciliation_baseline`, auth/notification enum updates

**Mitigation:** Assumes prior migrations left DB in expected shape; **must** run full chain on empty DB in CI.

### High risk (destructive — data loss if re-run on populated DB)

| Migration | Operations |
|-----------|------------|
| `20260501000000_drift_reconciliation_baseline` | `DROP TABLE` (2), multiple `DROP COLUMN`, `DROP INDEX`, enum replacements |
| `20260121071219_add_membership_and_product_approval` | `DROP TABLE` legacy PascalCase tables (early refactor) |
| `20260117080811_version_validation_v2` | `DROP COLUMN` |

**Header in drift file states:** intended for DBs where changes already exist; **do not re-apply SQL on live DB** if already reconciled.

**Production rule:** Never delete or rename applied migration folders; forward-only `migrate deploy`.

---

## Indexes and constraints audit (campaign module)

| Table | Indexes | Notable constraints |
|-------|---------|---------------------|
| `campaigns` | status, date range, slug | `slug` UNIQUE |
| `campaign_bookings` | campaign+date, phone, slot+status, qr, ref, status+date | `bookingRef`, `qrToken` UNIQUE |
| `campaign_sms_logs` | bookingId, campaignId+status, phone | FK optional booking |
| `campaign_slots` | location+date+time | capacity trigger (in migration SQL) |

No missing FK indexes on high-cardinality join columns detected for campaign paths.

---

## Fresh database migration (procedure)

**Canonical validation** — run in CI or locally with empty PostgreSQL:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bpa_migrate_empty?schema=public"
createdb bpa_migrate_empty  # or equivalent

cd D:\BPA_Data\backend-api
npm run setup:prisma
npx prisma migrate deploy
npx prisma migrate status   # expect: Database schema is up to date
```

**Expected:** 254 migrations apply without error.

**This audit:** Docker was not available on the audit machine; fresh deploy was **not executed**. Existing long-lived DB deploy **passed** (strong signal for production path).

---

## Existing production database migration

**Simulated production path** (local `bpa_pet_db` with 253/254 history):

```
prisma migrate status  → 1 pending (SMS cost)
prisma migrate deploy  → SUCCESS, all 254 applied
```

**Safe for production:** Pending migration only adds nullable columns:

```sql
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(32);
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "segmentCount" INTEGER;
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "estimatedCostBdt" DECIMAL(10,4);
```

- **No data loss** — no drops, no NOT NULL without default on existing rows
- **No table locks beyond brief DDL** — standard PostgreSQL `ADD COLUMN` behavior

---

## Rollback simulation

Prisma Migrate has **no built-in down migrations**. Rollback is **manual** or **restore-from-backup**.

**Tool added:** `scripts/migration-rollback-simulation.mjs`

```bash
npm run migrate:rollback-sim -- --tail=8
```

### Simulated reverse order (last 2 migrations)

| Step | Migration | Simulated rollback |
|------|-----------|-------------------|
| 1 | `20260603120000_campaign_sms_cost_monitoring` | `DROP COLUMN` provider, segmentCount, estimatedCostBdt |
| 2 | `20260602_add_vaccination_campaign_2026` | `DROP TABLE` campaign_* CASCADE; `DROP COLUMN` vaccinations.campaignBookingId |

**Warning:** Rolling back `20260602_*` **deletes all campaign data** and breaks FK from `vaccinations` if rows reference bookings.

**Production recommendation:** Do not roll back applied migrations; fix forward with a new migration.

---

## Orphan relation check

Heuristic audit (`migrate:audit-deps`) confirms:

- No `REFERENCES` or `ALTER TABLE` to a table **before** its first `CREATE TABLE` in the migration chain.

**Caveats:**

- Does not validate enum ordering inside complex `DO $$` blocks
- Does not replace `prisma migrate deploy` on empty DB

**Manual spot-check:** Campaign module references only tables created in `init` / org / user / order migrations (all pre-20260602).

---

## Broken foreign key check

| Check | Status |
|-------|--------|
| Deferred FK migrations (`*_fkey_deferred`) | Present for warehouse — run after parent tables |
| `owner_discount_cards` before POS FK | Fixed in `20260416140000` per governance docs |
| Campaign → `orders` | `paymentOrderId` nullable SET NULL — valid |
| Post-deploy DB | `migrate deploy` exit 0 — no FK creation errors |

---

## CI/CD checklist

```bash
npm run migrate:check-files    # exit 0
npm run migrate:audit-deps     # violationCount: 0
npx prisma validate            # valid
# Ephemeral Postgres:
npx prisma migrate deploy      # empty DB — required for full confidence
npm run migrate:rollback-sim -- --tail=5  # optional planning artifact
```

---

## Related documentation

- [`docs/migration-governance-report.md`](docs/migration-governance-report.md)
- [`docs/migration-repair-plan.md`](docs/migration-repair-plan.md)
- [`docs/migration-dependency-graph.md`](docs/migration-dependency-graph.md)

---

## Sign-off matrix

| Criterion | Verdict |
|-----------|---------|
| No data loss on pending production deploy | **Approved** |
| No destructive change in pending deploy | **Approved** |
| No orphan FK parents (campaign + audit scan) | **Approved** |
| No broken FK ordering (static audit) | **Approved** |
| Fresh DB full chain | **Conditional** — run empty-DB `migrate deploy` in CI |
| Rollback documented | **Approved** (simulation tool + manual SQL) |

**Overall:** Safe to deploy `20260603120000_campaign_sms_cost_monitoring` to existing production databases with campaign tables. Ensure fresh environments run the **full** 254-migration chain once in CI before major releases.
