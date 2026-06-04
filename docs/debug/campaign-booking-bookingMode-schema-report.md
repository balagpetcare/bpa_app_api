# Campaign booking — `bookingMode` column investigation

**Date:** 2026-06-04  
**Error:** `P2022` — `The column campaign_bookings.bookingMode does not exist in the current database`  
**Trigger:** `checkout.service.ts:275` — `prisma.campaignBooking.findFirst()`

---

## Executive summary

| Question | Answer |
|----------|--------|
| Does `bookingMode` exist in Prisma schema? | **Yes** — `CampaignBooking.bookingMode` (`CampaignBookingMode`, default `VENUE`) |
| Did it exist in PostgreSQL when the error occurred? | **No** (per runtime error) |
| Does it exist in PostgreSQL now (after `migrate deploy`)? | **Yes** — verified on `bpa_pet_db` via `information_schema` |
| Primary cause | **(A) Migration not applied** on the DB instance used by the API before deploy; not **(D) removed column** |
| Secondary risk | **(C) Schema drift** if `_prisma_migrations` says applied but DDL did not run (not observed on current DB) |

Prisma Client always selects all scalar fields on `campaignBooking` queries unless a `select` is used. Any `findFirst` / `create` / `findUnique` therefore references `bookingMode` once the field is in `schema.prisma`.

---

## Root-cause classification

| Option | Verdict | Evidence |
|--------|---------|----------|
| **A. Migration never executed** | **Most likely at failure time** | Terminal shows `bookingMode` missing; `last_command: npx prisma migrate deploy` suggests deploy was run after the error. Migration file exists but DB lagged behind Prisma schema + generated client. |
| **B. Migration failed** | Possible historically, **not current** | `_prisma_migrations` rows for zone-interest migrations have `rolled_back_at: null`. Current DB has enum + column. |
| **C. Schema drift** | Possible in theory, **not on inspected DB now** | `migrate status` reports up to date; live columns match Prisma. Drift would mean migration row without DDL — re-run deploy SQL idempotently to heal. |
| **D. Code references removed column** | **No** | Opposite: zone-interest feature **added** `bookingMode` to schema, migrations, and checkout/booking services. |

---

## Prisma model — `CampaignBooking` fields

From `prisma/schema.prisma` (mapped to `campaign_bookings`):

| Field | Type | Notes |
|-------|------|--------|
| `id` | Int | PK |
| `bookingRef` | String | unique |
| `qrToken` | String | unique |
| `campaignId` | Int | |
| `locationId` | Int? | nullable since zone-interest migration |
| `slotId` | Int? | nullable since zone-interest migration |
| **`bookingMode`** | **CampaignBookingMode** | **default VENUE** — **source of error** |
| `ownerUserId` | Int? | |
| `ownerPhone` | String | |
| `ownerName` | String | |
| `ownerAddressJson` | Json? | |
| `bookingDate` | DateTime | |
| `petCount` | Int | |
| `status` | CampaignBookingStatus | includes `PENDING_ASSIGNMENT` |
| `checkedInAt` | DateTime? | |
| `checkedInByUserId` | Int? | |
| `queueNumber` | String? | |
| `completedAt` | DateTime? | |
| `isWalkIn` | Boolean | |
| `paymentStatus` | CampaignPaymentStatus | |
| `paymentOrderId` | Int? | |
| `paidAmount` | Decimal? | |
| `cancelledAt` | DateTime? | |
| `cancelReason` | String? | |
| `refundStatus` | CampaignRefundStatus? | |
| `refundAmount` | Decimal? | |
| `linkSource` | String? | |
| `linkedAt` | DateTime? | |
| `rolloutRegionId` | Int? | checkout session migration |
| `coverageZoneId` | Int? | coverage zone migration |
| **`coverageZoneName`** | **String?** | zone-interest migration |
| **`bdAreaId`** | **Int?** | zone-interest migration |
| `bookingArea` | String? | coverage zone migration |
| `checkoutSessionId` | String? | unique |
| `ownerAlternatePhone` | String? | |
| `metadataJson` | Json? | |
| `createdAt` / `updatedAt` | DateTime | |

Enums:

- `CampaignBookingMode`: `VENUE`, `ZONE_INTEREST`
- `CampaignBookingStatus`: includes `PENDING_ASSIGNMENT` (added in same migration)

Indexes on model: `@@index([bookingMode])` among others.

---

## PostgreSQL — `campaign_bookings` columns (live inspection)

**Database:** `postgresql://…/bpa_pet_db?schema=public` (from `.env`)  
**Inspected after:** `npx prisma migrate deploy` (exit 0)

38 columns present, including:

- `bookingMode` — type `CampaignBookingMode`, NOT NULL  
- `coverageZoneName` — varchar, nullable  
- `bdAreaId` — int4, nullable  
- `coverageZoneId`, `bookingArea` — from earlier migration  
- `locationId`, `slotId` — nullable (NOT NULL dropped)

Enum `CampaignBookingMode` exists.  
`CampaignBookingStatus` includes `PENDING_ASSIGNMENT`.

---

## Missing columns (Prisma vs DB)

### At error time (inferred)

| Column / enum | In Prisma | In DB (at error) |
|---------------|-----------|------------------|
| `bookingMode` | Yes | **Missing** |
| `CampaignBookingMode` enum | Yes | **Likely missing** |
| `coverageZoneName` | Yes | **Likely missing** (same migration) |
| `bdAreaId` | Yes | **Likely missing** (same migration) |
| `PENDING_ASSIGNMENT` status value | Yes | **Likely missing** |

### After `migrate deploy` (current)

**No missing columns** — Prisma model and `information_schema` align for campaign booking fields.

---

## Migration chain (relevant)

| Migration | Purpose |
|-----------|---------|
| `20260602_add_vaccination_campaign_2026` | Creates `campaign_bookings` **without** `bookingMode`; `locationId`/`slotId` NOT NULL |
| `20260603120000_campaign_checkout_session` | `rolloutRegionId`, `checkoutSessionId`, `ownerAlternatePhone` |
| `20260604150000_campaign_booking_coverage_zone` | `coverageZoneId`, `bookingArea` |
| **`20260604180000_zone_interest_booking`** | **`bookingMode`**, `coverageZoneName`, `bdAreaId`; nullable loc/slot; `PENDING_ASSIGNMENT`; enum `CampaignBookingMode` |

### `20260604180000_zone_interest_booking` SQL (excerpt)

```sql
CREATE TYPE "CampaignBookingMode" AS ENUM ('VENUE', 'ZONE_INTEREST');
ALTER TYPE "CampaignBookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_ASSIGNMENT';
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "bookingMode" "CampaignBookingMode" NOT NULL DEFAULT 'VENUE';
ALTER TABLE "campaign_bookings" ALTER COLUMN "locationId" DROP NOT NULL;
ALTER TABLE "campaign_bookings" ALTER COLUMN "slotId" DROP NOT NULL;
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "coverageZoneName" VARCHAR(200);
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "bdAreaId" INTEGER;
-- indexes + bdAreaId FK
```

`_prisma_migrations` records:

- `20260604150000_campaign_booking_coverage_zone` — finished 2026-06-03T21:01:39Z  
- `20260604180000_zone_interest_booking` — finished 2026-06-03T22:43:18Z  

`npx prisma migrate status` → **Database schema is up to date!** (263 migrations)

---

## `checkout.service.ts` — line 275

```typescript
const existingToday = await prisma.campaignBooking.findFirst({
  where: {
    campaignId,
    ownerPhone,
    bookingDate: startOfDay(new Date()),
    status: { notIn: ["CANCELLED"] },
  },
});
```

- **No business-logic bug** at this line: standard duplicate-booking guard.
- **Fails** because Prisma generates `SELECT …, "bookingMode", …` for every `CampaignBooking` read.
- Same failure would hit **any** `campaignBooking` query without a narrow `select` that omits `bookingMode` (not recommended as a permanent fix).

Other `bookingMode` writes (zone-interest flow):

- `buildAddressJson` — `bookingMode` in JSON (session only, not DB column).
- `campaignBooking.create` — `bookingMode: "ZONE_INTEREST"` (~557) or `"VENUE"` (~691).

---

## Recent booking flow changes (context)

Zone-interest / Dhaka corporation booking work added:

1. Prisma fields: `bookingMode`, `coverageZoneName`, `bdAreaId`, nullable `locationId`/`slotId`, status `PENDING_ASSIGNMENT`.
2. Migration `20260604180000_zone_interest_booking`.
3. Services: `zoneInterest.service.ts`, `dhakaBooking.service.ts`, checkout branches for corp + zone interest.
4. Frontend: vaccination booking without venue; checkout sends `cityCorporationCode` + `bdAreaId`.

**Order of failure:** `prisma generate` + schema update + code deploy **before** `migrate deploy` on the target DB → classic P2022.

---

## Safest fix strategy (do not use `migrate reset` / `db push`)

Per `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`:

1. **Confirm target DB** — same `DATABASE_URL` as `npm run dev` (`.env` → `bpa_pet_db`).
2. **Apply pending migrations**
   ```bash
   node scripts/check-migration-integrity.js
   npx prisma migrate deploy
   node scripts/check-migration-integrity.js
   ```
3. **Verify DDL**
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'campaign_bookings' AND column_name = 'bookingMode';
   SELECT typname FROM pg_type WHERE typname = 'CampaignBookingMode';
   ```
4. **Regenerate client** (if schema changed since last generate)
   ```bash
   npx prisma generate
   ```
5. **Restart API** — long-running `npm run dev` does not reload DB schema.
6. **Re-test** — `POST /api/v1/campaign/public/checkout/init`.

If migration is marked applied but column still missing (drift):

- Do **not** edit applied migration files.
- Add a **new** idempotent migration (or governed SQL script) that only runs missing `ADD COLUMN IF NOT EXISTS` / `CREATE TYPE` guards from `20260604180000_zone_interest_booking`.
- Review `_prisma_migrations.logs` if available.

**Avoid:**

- `prisma migrate reset`, `db push` on production-like DB.
- Removing `bookingMode` from Prisma to silence errors (breaks zone-interest bookings).
- `select`-only workaround on `findFirst` without fixing DB (masks drift).

---

## Manual verification checklist

- [x] `migrate deploy` — `20260604190000_campaign_booking_zone_interest_reconcile` applied 2026-06-04  
- [x] Column `bookingMode` present in `campaign_bookings`  
- [x] `prisma.campaignBooking.findFirst` with `bookingMode` in SELECT — OK  
- [ ] Paid checkout HTTP — blocked by SSLCOMMERZ env unless configured  
- [x] Zone-interest checkout code path — `assignment?.rolloutRegionId` fix in `checkout.service.ts`  

---

## Reconciliation migration (2026-06-04)

**File:** `prisma/migrations/20260604190000_campaign_booking_zone_interest_reconcile/migration.sql`  

Idempotent re-apply of zone-interest DDL for databases where `20260604180000` was recorded but columns were missing.
