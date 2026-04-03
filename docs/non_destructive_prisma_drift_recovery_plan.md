# Non-Destructive Prisma Drift Recovery — COMPLETED

**Date:** 2026-03-29
**Database:** `bpa_pet_db` at `localhost:5432`
**Status:** COMPLETED — Drift fully resolved, zero data loss

**Ongoing policy:** See `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` for mandatory workflow before any future schema or migration change.

---

## Executive Summary

The development database had accumulated migration drift from 5 modified-after-application migration files, 3 rolled-back ghost entries, missing foreign keys, mismatched FK actions, and a COALESCE-based unique index that didn't match Prisma's expected format. This was resolved non-destructively by:

1. Backing up the database (pg_dump — 10.2 MB)
2. Cleaning 3 ghost entries and fixing 1 zero-step entry in `_prisma_migrations`
3. Updating checksums for 5 modified migrations
4. Creating a reconciliation baseline migration (`20260501000000`) and marking it as already applied
5. Adding 30 missing foreign keys and indexes to the live database
6. Fixing 3 FK ON DELETE action mismatches on `medicine_requisition_items`
7. Replacing a COALESCE-based unique index on `owner_delegations` with a standard Prisma-compatible version
8. Adding `shadowDatabaseUrl` to `prisma.config.ts`

**Result:** All three sources of truth are perfectly aligned:
- `prisma migrate diff --from-migrations --to-config-datasource` → "No difference detected."
- `prisma migrate diff --from-schema --to-config-datasource` → "No difference detected."
- `prisma migrate status` → "202 migrations found. Database schema is up to date!"
- `check-migration-integrity.js` → "All migration checksums match. No drift detected."

---

## 1. Root Causes of Drift

| # | Root Cause | Impact |
|---|-----------|--------|
| 1 | **Edited 5 applied migration files** | Checksum mismatch — Prisma detects "modified after application" |
| 2 | **`prisma db push` used during development** | Schema changes applied without migration files — shadow replay diverges |
| 3 | **Failed migration retries** (central_warehouse_foundation x2, backfill x1) | Ghost entries in `_prisma_migrations` |
| 4 | **Medicine requisitions DDL prepended to warehouse migration** | Checksum mismatch on `20260429120000` |
| 5 | **Feature removals without migration** | Producer columns/tables removed from schema + DB but old migrations still CREATE them |
| 6 | **COALESCE-based unique index** on `owner_delegations` | Non-standard index format that Prisma doesn't recognize as matching |

---

## 2. What Was Changed

### `_prisma_migrations` table (metadata only)
- Deleted 3 rolled-back ghost entries
- Fixed 1 zero-step entry → set `applied_steps_count = 1`
- Updated checksums for 5 modified migrations to match current disk content
- Added 1 new reconciliation baseline entry (`20260501000000_drift_reconciliation_baseline`)

### Live database schema (additive + corrective, zero data loss)
- Added 30 missing foreign keys and indexes (all idempotent `DO $$ ... EXCEPTION WHEN duplicate_object`)
- Fixed 3 FK ON DELETE actions on `medicine_requisition_items`:
  - `productId`: RESTRICT → SET NULL (matching schema.prisma)
  - `variantId`: RESTRICT → SET NULL (matching schema.prisma)
  - `medicineListingId`: SET NULL → RESTRICT (matching schema.prisma)
- Replaced COALESCE-based unique index on `owner_delegations` with standard btree unique index

### Files on disk
| File | Change |
|------|--------|
| `prisma/migrations/20260501000000_drift_reconciliation_baseline/migration.sql` | New — reconciliation baseline |
| `prisma.config.ts` | Added `shadowDatabaseUrl` |
| `scripts/check-migration-integrity.js` | New — governance tool |
| `scripts/reconcile-migrations.js` | New — kept for reference |
| `docs/non_destructive_prisma_drift_recovery_plan.md` | This document |

### Backups created
| File | Size | Contents |
|------|------|----------|
| `backups/bpa_pet_db_pre_drift_fix_20260329.dump` | 10.2 MB | Full pg_dump (custom format) |
| `backups/prisma_migrations_backup_20260329.sql` | 62 KB | `_prisma_migrations` INSERT dump |

---

## 3. Data Risk Assessment

**No data risk remains.** Specifically:

| Table | Rows | Status |
|-------|------|--------|
| `stock_request_items` | 17 | Preserved — cancellation columns intact |
| `products` | 120 | Preserved — `isMedicine`, `medicineListingId` intact |
| `medicine_requisitions` | 2 | Preserved — FKs now correct |
| `medicine_requisition_items` | 19 | Preserved — FK actions corrected |
| `medicine_requisition_timeline` | 5 | Preserved — FKs added |
| `notifications` | 18 | Preserved — `panel` column correctly absent |
| `appointments` | 10 | Preserved — index strategy unchanged |
| All 391 tables | Various | All preserved, zero drops |

---

## 4. Commands Now Safe to Use

| Command | Status | Notes |
|---------|--------|-------|
| `npx prisma migrate dev --name <name>` | SAFE | Will work without drift errors |
| `npx prisma migrate dev --create-only` | SAFE | Preview migration SQL |
| `npx prisma migrate deploy` | SAFE | Apply pending migrations |
| `npx prisma migrate status` | SAFE | Reports "up to date" |
| `npx prisma validate` | SAFE | Schema is valid |
| `npx prisma generate` | SAFE | Generates client |
| `npm run typecheck` | SAFE | Passes with 0 errors |
| `node scripts/check-migration-integrity.js` | SAFE | Governance check |

## 5. Commands to AVOID

| Command | Risk | Alternative |
|---------|------|-------------|
| `prisma migrate reset` | DROPS ALL DATA | Never use on data-bearing DB |
| `prisma db push` | Causes drift | Use `migrate dev` instead |
| Editing applied migration files | Causes checksum mismatch | Create new migration |
| Deleting migration folders | Breaks history | Never delete applied migrations |

---

## 6. Recommended Workflow for Future Schema Changes

### On local development:
```bash
# 1. Backup
docker exec bpa_db pg_dump -U bpa_admin -d bpa_pet_db -Fc -f /tmp/backup.dump

# 2. Edit schema
# Edit prisma/schema.prisma

# 3. Preview migration
npx prisma migrate dev --name descriptive_name --create-only

# 4. Review generated SQL
# Check prisma/migrations/<name>/migration.sql

# 5. Apply
npx prisma migrate dev

# 6. Validate
npx prisma generate
npm run typecheck

# 7. Commit everything including the migration folder
git add prisma/
```

### On shared/staging/production:
```bash
npx prisma migrate deploy
```

### For reconciliation (if drift happens again):
```bash
# 1. Generate diff
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script

# 2. Create migration folder with the SQL
# 3. Mark as applied
npx prisma migrate resolve --applied <name>

# 4. Fix live DB to match
# 5. Update checksum if migration file was modified
```

---

## 7. Manual Verification Checklist

- [x] `prisma migrate status` → "202 migrations found. Database schema is up to date!"
- [x] `prisma migrate diff --from-migrations --to-config-datasource` → "No difference detected."
- [x] `prisma migrate diff --from-schema --to-config-datasource` → "No difference detected."
- [x] `prisma validate` → "The schema is valid"
- [x] `prisma generate` → Generated Prisma Client v7.6.0
- [x] `npm run typecheck` → Exit code 0
- [x] `check-migration-integrity.js` → "All migration checksums match. No drift detected."
- [x] 202 DB entries = 202 disk folders
- [x] 0 modified-after-application migrations
- [x] 0 rolled-back or ghost entries
- [x] All 391 tables preserved
- [x] All data-bearing tables have correct row counts
- [x] `stock_request_items` has cancellation columns
- [x] `stock_transfers` has no unique constraint on `stockRequestId`
- [x] `medicine_requisition*` tables have correct foreign keys with correct ON DELETE actions
- [x] `owner_delegations` has standard Prisma-compatible unique index
- [x] `products` has `isMedicine` and `medicineListingId` columns with FK and indexes
