# Campaign Config Table Analysis

**Date**: 2026-06-04  
**Issue**: Admin Campaign page fails with Prisma P2021 error  
**Error**: `Table does not exist: public.campaign_configs`

---

## Executive Summary

**ROOT CAUSE**: The Prisma schema was modified to add `CampaignConfig` and `CampaignConfigHistory` models, but **NO migration was created or applied** to create these tables in the database.

**Status**: Schema-Database Mismatch (not drift)  
**Impact**: CRITICAL — Admin campaign pages and booking flows fail when attempting to query or create campaign config records.

---

## Investigation Results

### A. Does CampaignConfig exist in schema?

**YES** ✓

**Location**: `prisma/schema.prisma` lines 13983-14012

```prisma
model CampaignConfig {
  id         Int @id @default(autoincrement())
  campaignId Int @unique
  version    Int @default(1)

  // Booking & Capacity
  bookingEnabled     Boolean @default(true)
  walkInAllowed      Boolean @default(true)
  approvalRequired   Boolean @default(false)
  slotRequired       Boolean @default(true)
  autoCloseWhenFull  Boolean @default(true)
  maxCapacity        Int     @default(0)
  maxCatsPerBooking  Int     @default(5)
  showRemainingSlots Boolean @default(true)
  lateBookingAllowed Boolean @default(false)

  // Payment
  onlinePaymentEnabled Boolean @default(false)
  payAtVenueEnabled    Boolean @default(false)

  // Advanced (JSON)
  metadataJson Json?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@map("campaign_configs")
}
```

**Campaign model relation**: `prisma/schema.prisma` line 13974

```prisma
model Campaign {
  // ... other fields
  config CampaignConfig?
  // ... other relations
}
```

---

### B. Which migration should create campaign_configs?

**EXPECTED**: A migration named something like `YYYYMMDDHHMMSS_add_campaign_config_tables`

**ACTUAL**: **NO SUCH MIGRATION EXISTS** ✗

---

### C. Does migration exist?

**NO** ✗

**Search Results**:
- Searched all 260 migration files for "campaign_config"
- Searched for SQL file patterns: `**/*campaign*config*.sql`
- Result: **0 files found**

**Latest migrations** (by date):
1. `20260604120000_campaign_national_rollout`
2. `20260603190000_coverage_zones`
3. `20260603180000_campaign_countdown_fields`
4. `20260603140000_payment_transaction_log`
5. `20260603120000_campaign_sms_cost_monitoring`
6. `20260603120000_campaign_checkout_session`
7. `20260603031500_centralized_location_system`
8. `20260602_add_vaccination_campaign_2026`

**None of these migrations create `campaign_configs` or `campaign_config_history` tables.**

---

### D. Was migration applied?

**N/A** — Migration does not exist, therefore cannot be applied.

**Prisma migrate status**:
```
260 migrations found in prisma/migrations
Database schema is up to date!
```

This message is **misleading** in this context. Prisma only checks if:
- All migration files in `prisma/migrations/` have been applied

It does **NOT** check if:
- The `schema.prisma` has changes that were never converted to migrations

---

### E. Was migration partially applied?

**NO** ✗

The tables do not exist at all in the database.

**Migration integrity check**:
```bash
$ node scripts/check-migration-integrity.js
All migration checksums match. No drift detected.
```

**Interpretation**: This confirms that:
- All existing migrations are intact (checksums match)
- No manual database changes occurred (no drift)
- BUT: Schema changes exist that were never migrated

---

### F. Does campaign.findUnique include CampaignConfig relation?

**PARTIAL** ⚠️

**1. getCampaignById** — **YES** ✓
`src/api/v1/modules/campaign/campaign.service.ts` line 107

```typescript
export async function getCampaignById(id: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      locations: { ... },
      vaccineTypes: { ... },
      organizer: { ... },
      config: true,  // ← ATTEMPTS TO INCLUDE config
      _count: { ... },
    },
  });
  // ...
}
```

**Result**: This query **WILL FAIL** with P2021 error when called.

---

**2. getCampaignBySlug** — **NO** (but calls config service separately) ⚠️
`src/api/v1/modules/campaign/campaign.service.ts` lines 127-150

```typescript
export async function getCampaignBySlug(slug: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      locations: { ... },
      vaccineTypes: { ... },
      // config NOT included here
    },
  });
  // ...
}
```

**Controller** calls config service separately:  
`src/api/v1/modules/campaign/campaign.controller.ts` line 74

```typescript
export async function getPublicCampaignBySlugHandler(req, res, next) {
  // ...
  const campaign = await getCampaignBySlug(slug);
  
  const configRow = await getCampaignConfigOrNull(campaign.id);  // ← FAILS HERE
  // ...
}
```

`getCampaignConfigOrNull` implementation:  
`src/api/v1/modules/campaign/config.service.ts` line 90-91

```typescript
export async function getCampaignConfigOrNull(campaignId: number) {
  return prisma.campaignConfig.findUnique({ where: { campaignId } });  // ← P2021 ERROR
}
```

**Result**: This query **WILL FAIL** with P2021 error.

---

**3. createCampaign** — **ATTEMPTS TO CREATE config row**
`src/api/v1/modules/campaign/campaign.service.ts` lines 62-72

```typescript
export async function createCampaign(input: CreateCampaignInput, createdByUserId?: number) {
  // ... create campaign
  
  // Create default config row
  await prisma.campaignConfig.create({  // ← P2021 ERROR
    data: {
      campaignId: campaign.id,
      version: 1,
      bookingEnabled: true,
      onlinePaymentEnabled: input.pricingType !== "FREE",
      payAtVenueEnabled: false,
      walkInAllowed: input.allowWalkIns ?? true,
      maxCatsPerBooking: input.maxPetsPerBooking ?? 5,
    },
  });
  // ...
}
```

**Result**: Campaign creation **WILL FAIL** when attempting to create the default config row.

---

## Affected Code Paths

### Direct Database Access Failures

1. **Admin Campaign List/View**
   - Path: Admin Panel → Campaigns → View/Edit
   - Code: `getCampaignById` with `include: { config: true }`
   - Error: P2021 on page load

2. **Public Booking Page**
   - Path: `vaccination_2026` app → Campaign Booking
   - Code: `getPublicCampaignBySlugHandler` → `getCampaignConfigOrNull`
   - Error: P2021 on page load

3. **Campaign Creation**
   - Path: Admin Panel → Create Campaign
   - Code: `createCampaign` → `prisma.campaignConfig.create`
   - Error: P2021 when saving new campaign

4. **Booking Creation**
   - Path: Booking flow checkout
   - Code: `booking.service.ts` → `getCampaignConfigOrNull`
   - Error: P2021 during booking submission

5. **Checkout Flow**
   - Path: Campaign checkout
   - Code: `checkout.service.ts` → `getCampaignConfigOrNull`
   - Error: P2021 during checkout initialization

---

## Why Prisma Says "Database schema is up to date"

Prisma's `migrate status` command checks:
- ✓ Are all files in `prisma/migrations/` recorded in `_prisma_migrations` table?
- ✓ Are the checksums valid?

Prisma does **NOT** check:
- ✗ Does `schema.prisma` have changes that were never turned into migrations?

**This is NOT drift** (database has changes not in schema).  
**This IS schema-database mismatch** (schema has changes not in database).

---

## Migration Analysis

### Migration Timeline (Recent)

| Date | Migration | Creates campaign_configs? |
|------|-----------|--------------------------|
| 2026-06-04 | `campaign_national_rollout` | NO |
| 2026-06-03 | `coverage_zones` | NO |
| 2026-06-03 | `campaign_countdown_fields` | NO |
| 2026-06-02 | `add_vaccination_campaign_2026` | NO (base campaign tables only) |

### Expected Migration (MISSING)

**Should exist**:
```
prisma/migrations/20260604_HHMMSS_add_campaign_config_tables/
  └── migration.sql
```

**Should contain**:
```sql
-- CreateTable
CREATE TABLE "campaign_configs" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "walkInAllowed" BOOLEAN NOT NULL DEFAULT true,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "slotRequired" BOOLEAN NOT NULL DEFAULT true,
    "autoCloseWhenFull" BOOLEAN NOT NULL DEFAULT true,
    "maxCapacity" INTEGER NOT NULL DEFAULT 0,
    "maxCatsPerBooking" INTEGER NOT NULL DEFAULT 5,
    "showRemainingSlots" BOOLEAN NOT NULL DEFAULT true,
    "lateBookingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "onlinePaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payAtVenueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_config_history" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "changedBy" INTEGER,
    "changeReason" TEXT,
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_configs_campaignId_key" ON "campaign_configs"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_config_history_campaignId_version_idx" ON "campaign_config_history"("campaignId", "version");

-- AddForeignKey
ALTER TABLE "campaign_configs" ADD CONSTRAINT "campaign_configs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Database State

**Tables**:
- `campaigns` — EXISTS ✓
- `campaign_configs` — **DOES NOT EXIST** ✗
- `campaign_config_history` — **DOES NOT EXIST** ✗

**Foreign Key**:
- `campaign_configs.campaignId → campaigns.id` — **NOT CREATED** ✗

---

## Impact Assessment

### Severity: **CRITICAL** 🔴

**Broken Features**:
1. Admin campaign list/view/edit pages
2. Public booking pages for all campaigns
3. Creating new campaigns
4. Creating new bookings
5. Checkout flow
6. Campaign analytics (calls config)
7. Any API endpoint that includes campaign config

**User Experience**:
- Admin panel campaign pages throw 500 errors
- Public booking pages fail to load
- Cannot create new campaigns
- Cannot complete bookings
- API returns P2021 Prisma errors

---

## Root Cause Analysis

### What Happened

1. **Schema Modified** (estimated: around 2026-06-03/04)
   - Developer added `CampaignConfig` and `CampaignConfigHistory` models to `schema.prisma`
   - Developer added `config CampaignConfig?` relation to `Campaign` model

2. **Code Written**
   - `config.service.ts` created with CRUD operations
   - `campaign.service.ts` updated to create/query config
   - `campaign.controller.ts` updated to include config
   - `booking.service.ts` updated to validate against config
   - `checkout.service.ts` updated to validate against config
   - `analytics.service.ts` created with config-dependent queries

3. **Migration Never Created**
   - Developer **DID NOT** run `npx prisma migrate dev --name add_campaign_config_tables`
   - No migration file generated
   - No SQL DDL created
   - No `prisma migrate deploy` executed

4. **Code Deployed**
   - Code assuming tables exist was deployed
   - Schema changes were not applied to database
   - Runtime errors started occurring

### Why It Wasn't Caught

1. **TypeScript compilation succeeds**
   - Prisma Client types are generated from schema
   - TypeScript sees `CampaignConfig` type even though table doesn't exist
   - No compile-time error

2. **`prisma generate` succeeds**
   - Generates types from schema
   - Does not check database state

3. **`prisma migrate status` misleading**
   - Reports "Database schema is up to date"
   - Only checks if existing migrations are applied
   - Does not detect missing migrations for schema changes

4. **No runtime testing before deployment**
   - Issue only appears when code actually executes queries

---

## Solution Required

### Immediate Action

**Create and apply the missing migration** following the non-destructive policy:

```bash
# 1. Create migration (--create-only to review SQL first)
npx prisma migrate dev --name add_campaign_config_tables --create-only

# 2. Review generated SQL in new migration folder
#    Verify it only contains CREATE TABLE statements (non-destructive)

# 3. Apply migration
npx prisma migrate deploy

# 4. Verify integrity
node scripts/check-migration-integrity.js

# 5. Verify tables exist
npx prisma db execute --stdin <<< "SELECT table_name FROM information_schema.tables WHERE table_name IN ('campaign_configs', 'campaign_config_history');"
```

### Verification Steps

After migration applied:

1. ✓ Tables `campaign_configs` and `campaign_config_history` exist
2. ✓ Foreign key constraint exists
3. ✓ Indexes created
4. ✓ Admin campaign pages load without errors
5. ✓ Public booking pages load without errors
6. ✓ Can create new campaigns
7. ✓ Can create bookings
8. ✓ API endpoints return config data

---

## Prevention

### Process Improvements

1. **Always create migrations for schema changes**
   ```bash
   # After editing schema.prisma:
   npx prisma migrate dev --name <descriptive_name> --create-only
   ```

2. **Review SQL before applying**
   - Check for destructive operations (DROP, TRUNCATE)
   - Verify indexes and constraints
   - Follow PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md

3. **Run integrity check before/after**
   ```bash
   node scripts/check-migration-integrity.js
   ```

4. **Test runtime before deployment**
   - Execute actual queries against affected tables
   - Load affected pages/endpoints
   - Verify no P2021 errors

5. **CI/CD gates**
   - Add check: "Does schema.prisma have changes not in migrations?"
   - Run `prisma migrate status` in CI
   - Run integrity check in CI

---

## Related Documentation

- `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md` — Migration policy
- `docs/campaign-config/implementation-plan.md` — Original feature plan
- `docs/campaign-config/implementation-report.md` — Implementation summary
- `docs/campaign-config/final-validation-report.md` — Validation results

---

## Appendix: Prisma Error P2021

**Error Code**: P2021  
**Message**: `The table `<table_name>` does not exist in the current database.`

**Common Causes**:
1. Migration not created for schema changes (THIS CASE)
2. Migration not applied (`prisma migrate deploy` not run)
3. Wrong database connection string
4. Manual table deletion

**Resolution**: Create and apply the missing migration.

---

**Analysis completed**: 2026-06-04 01:00 AM (UTC+6)  
**Analyst**: AI Agent  
**Status**: READY FOR FIX
