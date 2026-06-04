# User Profile Location Schema Gap — Forensic Report

**Project:** `D:\BPA_Data\backend-api`  
**Database:** `bpa_pet_db` @ `localhost:5432` (from `.env`)  
**Error:** Prisma `P2022` — column `user_profiles.divisionId` does not exist  
**Date:** 2026-06-03  
**Mode:** Read-only diagnosis — no code or schema changes applied

---

## Executive Summary

| Layer | Status |
|-------|--------|
| **Prisma schema (`UserProfile`)** | Defines all five location FK columns + five indexes |
| **PostgreSQL (`user_profiles`)** | **None** of the five columns exist |
| **Root cause** | Migration `20260603031500_centralized_location_system` was **never applied** to this database |
| **Partial migration?** | **No** — no `_prisma_migrations` row, no columns, no indexes for `user_profiles` |
| **Later migrations** | Several **newer** `20260603*` / `20260604*` migrations **are** applied, so the DB is **ahead** of the location migration in history |

The runtime error is expected: Prisma Client was generated from a schema that includes `divisionId`, but the table was never altered.

---

## A. Prisma Schema — `UserProfile`

**File:** `prisma/schema.prisma` (lines 140–178)

| Field | Prisma type | DB column (expected) | Notes |
|-------|-------------|----------------------|--------|
| `divisionId` | `Int?` | `"divisionId"` INTEGER NULL | No `@relation` to `BdDivision` |
| `districtId` | `Int?` | `"districtId"` INTEGER NULL | No `@relation` |
| `upazilaId` | `Int?` | `"upazilaId"` INTEGER NULL | No `@relation` |
| `unionId` | `Int?` | `"unionId"` INTEGER NULL | No `@relation` |
| `areaId` | `Int?` | `"areaId"` INTEGER NULL | No `@relation` |

**Related non-location fields (for context):**

| Field | In schema | In DB |
|-------|-----------|-------|
| `gender` | Yes | Yes (`Gender` enum) |
| `dateOfBirth` | Yes | Yes |
| `addressJson` | Yes | Yes (jsonb) |
| `emergencyContactJson` | Yes | Yes (jsonb) |
| `providerDisplayName` / `providerAvatarUrl` / `providerKey` / `providerSyncedAt` | Yes | Yes |

**Indexes in schema:**

```prisma
@@index([divisionId])
@@index([districtId])
@@index([upazilaId])
@@index([unionId])
@@index([areaId])
```

**Foreign keys in schema:** None on location columns (soft integer references only). Existing FKs: `userId` → `users`, `avatarMediaId` / `coverMediaId` → `media`.

---

## B. PostgreSQL — `user_profiles`

**Evidence:** Live query against `information_schema.columns` and `pg_indexes` on 2026-06-03.

### B.1 Location columns

| Column | In PostgreSQL |
|--------|---------------|
| `divisionId` | **Missing** |
| `districtId` | **Missing** |
| `upazilaId` | **Missing** |
| `unionId` | **Missing** |
| `areaId` | **Missing** |

### B.2 Actual columns (20 total)

`id`, `userId`, `displayName`, `username`, `bio`, `visibility`, `showEmail`, `showPhone`, `avatarMediaId`, `coverMediaId`, `createdAt`, `updatedAt`, `gender`, `dateOfBirth`, `addressJson`, `emergencyContactJson`, `providerDisplayName`, `providerAvatarUrl`, `providerKey`, `providerSyncedAt`

### B.3 Indexes present

| Index | Present |
|-------|---------|
| `user_profiles_pkey` | Yes |
| `user_profiles_userId_key` | Yes |
| `user_profiles_username_key` | Yes |
| `user_profiles_username_idx` | Yes |
| `user_profiles_divisionId_idx` | **Missing** |
| `user_profiles_districtId_idx` | **Missing** |
| `user_profiles_upazilaId_idx` | **Missing** |
| `user_profiles_unionId_idx` | **Missing** |
| `user_profiles_areaId_idx` | **Missing** |

### B.4 Foreign keys present

| Constraint | References |
|------------|------------|
| `user_profiles_userId_fkey` | `users(id)` |
| `user_profiles_avatarMediaId_fkey` | `media(id)` |
| `user_profiles_coverMediaId_fkey` | `media(id)` |

**Missing FKs (location):** None expected — migration SQL does not add FK constraints on `user_profiles` location columns (matches Prisma).

---

## C. Side-by-side comparison

| Artifact | `divisionId` | `districtId` | `upazilaId` | `unionId` | `areaId` | Location indexes | Location FKs |
|----------|--------------|--------------|-------------|-----------|----------|------------------|--------------|
| **Prisma `UserProfile`** | Yes | Yes | Yes | Yes | Yes | 5 | No |
| **PostgreSQL `user_profiles`** | No | No | No | No | No | 0 | No |
| **Gap** | Missing | Missing | Missing | Missing | Missing | 5 missing | N/A |

---

## D. Migration that should have created them

### D.1 Primary migration (not applied)

| Property | Value |
|----------|--------|
| **Name** | `20260603031500_centralized_location_system` |
| **Path** | `prisma/migrations/20260603031500_centralized_location_system/migration.sql` |
| **Purpose** | Centralized Bangladesh location system (additive) |

**Relevant SQL for `user_profiles` (lines 34–44):**

```sql
ALTER TABLE "user_profiles"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;

CREATE INDEX "user_profiles_divisionId_idx" ON "user_profiles"("divisionId");
CREATE INDEX "user_profiles_districtId_idx" ON "user_profiles"("districtId");
CREATE INDEX "user_profiles_upazilaId_idx" ON "user_profiles"("upazilaId");
CREATE INDEX "user_profiles_unionId_idx" ON "user_profiles"("unionId");
CREATE INDEX "user_profiles_areaId_idx" ON "user_profiles"("areaId");
```

**Same migration also creates (not present in DB):**

- Table `bd_unions` + FK to `bd_upazilas`
- Column `bd_areas.unionId` + FK
- Location columns on `organizations`, `branches`, `doctor_verifications`, `staff_invites`, `producer_orgs`, `producer_factories`
- `owner_profiles.unionId` only (see below)
- Enum `LocationCoverageEntityType` + table `location_coverage_assignments`

### D.2 Earlier migrations (already applied) — do **not** add `user_profiles` location columns

| Migration | Effect on `user_profiles` |
|-----------|---------------------------|
| `20260116192630_owner_profile_data` | Creates base `user_profiles` (no location cols) |
| `20260406130000_user_enterprise_profile_app_settings` | Adds `gender`, `dateOfBirth`, `addressJson`, `emergencyContactJson` |
| `20260406150000_social_provider_profile_bootstrap` | Adds provider snapshot fields |

No other migration in the repo adds `user_profiles.divisionId` et al.

---

## E. Migration apply state

### E.1 Prisma CLI

```text
npx prisma migrate status

Following migration have not yet been applied:
20260603031500_centralized_location_system
```

259 migrations in folder; **exactly one** pending.

### E.2 `_prisma_migrations` table

| Check | Result |
|-------|--------|
| Row for `20260603031500_centralized_location_system` | **Absent** |
| `rolled_back_at` / failed logs for that name | **N/A** (never started) |

### E.3 June 2026 migrations **applied** (DB has rows; location migration does not)

| migration_name | finished_at (UTC) |
|----------------|-------------------|
| `20260602_add_vaccination_campaign_2026` | 2026-06-02T12:39:25.567Z |
| `20260603120000_campaign_sms_cost_monitoring` | 2026-06-02T13:15:08.401Z |
| `20260604120000_campaign_national_rollout` | 2026-06-02T14:41:42.335Z |
| `20260603180000_campaign_countdown_fields` | 2026-06-02T19:16:37.582Z |
| `20260603120000_campaign_checkout_session` | 2026-06-02T20:19:29.611Z |
| `20260603140000_payment_transaction_log` | 2026-06-02T20:19:29.653Z |

**Not in DB:** `20260603031500_centralized_location_system`

### E.4 Interpretation (answers D–F)

| Question | Answer |
|----------|--------|
| **D. Which migration should have created them?** | `20260603031500_centralized_location_system` |
| **E. Exists but not applied?** | **Yes** — file exists in repo; DB never recorded it |
| **F. Failed partially?** | **No** for `user_profiles` — zero columns/indexes from that migration exist; `bd_unions` and `location_coverage_assignments` also **missing** |
| **`user_profiles` out of sync?** | **Yes** — schema/Client ahead of database |

**Likely history:** The centralized location migration was **added to the repository after** this database had already applied later-dated migrations (`20260603120000*`, `20260604120000*`, etc.). Prisma correctly reports it as the single pending migration. This is **not** a half-applied `ALTER TABLE user_profiles`.

---

## F. Broader location drift (same pending migration)

Other tables from the **same** migration file:

| Table | Expected from pending migration | Observed in DB |
|-------|--------------------------------|----------------|
| `user_profiles` | 5 cols + 5 indexes | **All missing** |
| `organizations` | 5 cols + 5 indexes | **All missing** |
| `branches` | 5 cols + 5 indexes | **All missing** |
| `doctor_verifications` | 5 cols + 5 indexes | **All missing** |
| `owner_profiles` | `unionId` + index | `divisionId`,`districtId`,`upazilaId`,`areaId` from **older** migration; **`unionId` missing** |
| `bd_unions` | New table | **Missing** |
| `location_coverage_assignments` | New table + enum | **Missing** |
| `bd_areas.unionId` | Column + FK | **Not verified column-level** (table exists) |

**BD master tables already present:** `bd_divisions`, `bd_districts`, `bd_upazilas`, `bd_areas` (from earlier location work).

Any code path querying `UserProfile.divisionId`, `Organization.divisionId`, etc. will hit the same class of `P2022` until the pending migration runs.

---

## G. Missing objects checklist (`user_profiles` only)

### Missing columns

- `divisionId` (INTEGER, nullable)
- `districtId` (INTEGER, nullable)
- `upazilaId` (INTEGER, nullable)
- `unionId` (INTEGER, nullable)
- `areaId` (INTEGER, nullable)

### Missing indexes

- `user_profiles_divisionId_idx`
- `user_profiles_districtId_idx`
- `user_profiles_upazilaId_idx`
- `user_profiles_unionId_idx`
- `user_profiles_areaId_idx`

### Missing foreign keys

- **None** — by design in migration and Prisma (integer refs only).

### Required migration file

| File | Action needed |
|------|----------------|
| `prisma/migrations/20260603031500_centralized_location_system/migration.sql` | Apply in full via `prisma migrate deploy` (or dev equivalent) |

**Do not** hand-roll only `user_profiles` columns unless you intentionally want DB history out of sync with Prisma Migrate.

---

## H. Risk assessment

| Risk | Level | Detail |
|------|-------|--------|
| **P2022 on profile/location APIs** | High | Any `prisma.userProfile` select/update including location fields fails |
| **Applying only `user_profiles` DDL manually** | Medium | Leaves `bd_unions`, coverage table, other entities broken |
| **Skipping pending migration because later ones applied** | High | Prisma will keep reporting drift; other models also wrong |
| **Data loss on migrate deploy** | Low | Migration is additive (`ADD COLUMN`, new tables) |
| **Deploy order in production** | High | Ensure `20260603031500` runs before relying on location features |
| **`owner_profiles.unionId` gap** | Medium | Schema expects `unionId`; DB missing until same migration |

---

## I. Safe repair plan (do not run automatically)

### Phase 1 — Confirm (repeatable)

1. `npx prisma migrate status` — expect pending `20260603031500_centralized_location_system`.
2. Re-check columns:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'user_profiles'
     AND column_name IN ('divisionId','districtId','upazilaId','unionId','areaId');
   ```
   Expect **0 rows** before fix.

### Phase 2 — Apply migration (preferred)

1. **Backup** `bpa_pet_db` (pg_dump or snapshot).
2. Stop or quiesce writers if possible (optional; migration is additive).
3. Run:
   ```bash
   npx prisma migrate deploy
   ```
   Or in development:
   ```bash
   npx prisma migrate dev
   ```
4. Confirm `_prisma_migrations` contains `20260603031500_centralized_location_system` with `finished_at` set.
5. Confirm five columns + five indexes on `user_profiles`.
6. `npx prisma generate` (if Client not regenerated post-migrate).

### Phase 3 — Post-migrate validation

1. `npx prisma migrate status` — no pending migrations.
2. Smoke: read/update `UserProfile` with location IDs via API or script.
3. Run `npm run seed:location-master` / `migrate:location-references` if your playbook requires backfill (separate scripts; not part of DDL migration).
4. Verify `bd_unions` and `location_coverage_assignments` exist.

### Phase 4 — If `migrate deploy` fails on ordering

If deploy refuses because of migration history quirks:

1. **Do not** delete rows from `_prisma_migrations` without DBA review.
2. Resolve with Prisma-documented flow: fix blocking issue, then `migrate deploy` again.
3. Last resort only: `prisma migrate resolve` after applying the SQL manually — must be done by someone who understands migration history.

**Avoid:** Copying only the `user_profiles` `ALTER TABLE` fragment — you will still lack `bd_unions`, coverage tables, and other entity columns defined in the same file.

### Phase 5 — Application

1. Restart API after `prisma generate`.
2. Retest the endpoint that triggered `P2022`.

---

## J. Evidence log

| Command / source | Result |
|------------------|--------|
| `npx prisma migrate status` | 1 pending: `20260603031500_centralized_location_system` |
| `information_schema.columns` on `user_profiles` | 20 columns; 0 location columns |
| `pg_indexes` on `user_profiles` | 4 indexes; 0 location indexes |
| `_prisma_migrations` LIKE `202606%` | 6 applied; centralized **absent** |
| `bd_unions` / `location_coverage_assignments` | Tables **not** present |
| Prisma schema lines 156–177 | All 5 fields + 5 indexes defined |

---

## K. Sign-off

| Item | Status |
|------|--------|
| Code modified | **No** |
| Migrations applied | **No** |
| Fixes implemented | **No** — repair plan only |
| Report generated | **Yes** — this file |

**Conclusion:** `P2022` on `user_profiles.divisionId` is a **schema–database drift** issue caused by an **unapplied** migration, not a corrupt Prisma model or partial DDL on `user_profiles`. Apply `20260603031500_centralized_location_system` in full to align PostgreSQL with the schema.
