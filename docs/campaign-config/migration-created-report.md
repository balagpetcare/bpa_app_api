# Migration Created Report

**Date**: 2026-06-04 01:09 AM (UTC+6)  
**Migration**: `20260604010800_add_campaign_config_tables`  
**Status**: Created ✓

## Migration Details

**Migration Name**: `20260604010800_add_campaign_config_tables`  
**Location**: `prisma/migrations/20260604010800_add_campaign_config_tables/migration.sql`

## Tables Created

### 1. campaign_configs

**Purpose**: Store dynamic campaign configuration settings

**Columns**:
- `id` — Primary key (SERIAL)
- `campaignId` — Foreign key to campaigns table (UNIQUE)
- `version` — Configuration version (INTEGER, default 1)
- `bookingEnabled` — Enable/disable booking (BOOLEAN, default true)
- `walkInAllowed` — Allow walk-in registrations (BOOLEAN, default true)
- `approvalRequired` — Require approval for bookings (BOOLEAN, default false)
- `slotRequired` — Require slot selection (BOOLEAN, default true)
- `autoCloseWhenFull` — Auto-close when capacity reached (BOOLEAN, default true)
- `maxCapacity` — Maximum campaign capacity (INTEGER, default 0)
- `maxCatsPerBooking` — Maximum cats per booking (INTEGER, default 5)
- `showRemainingSlots` — Display remaining slots (BOOLEAN, default true)
- `lateBookingAllowed` — Allow late bookings (BOOLEAN, default false)
- `onlinePaymentEnabled` — Enable online payment (BOOLEAN, default false)
- `payAtVenueEnabled` — Enable venue payment (BOOLEAN, default false)
- `metadataJson` — Additional configuration (JSONB, nullable)
- `createdAt` — Creation timestamp (TIMESTAMP, default now)
- `updatedAt` — Update timestamp (TIMESTAMP, auto-update)

**Constraints**:
- Primary key: `campaign_configs_pkey` on `id`
- Unique index: `campaign_configs_campaignId_key` on `campaignId`
- Foreign key: `campaign_configs_campaignId_fkey` → `campaigns(id)` CASCADE DELETE

### 2. campaign_config_history

**Purpose**: Audit trail for campaign configuration changes

**Columns**:
- `id` — Primary key (SERIAL)
- `campaignId` — Campaign reference (INTEGER)
- `version` — Config version at time of change (INTEGER)
- `changedBy` — User who made the change (INTEGER, nullable)
- `changeReason` — Reason for change (TEXT, nullable)
- `configJson` — Full config snapshot (JSONB)
- `createdAt` — Change timestamp (TIMESTAMP, default now)

**Constraints**:
- Primary key: `campaign_config_history_pkey` on `id`
- Index: `campaign_config_history_campaignId_version_idx` on `(campaignId, version)`

## Migration SQL

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

## Schema Alignment

**✓ Matches Prisma Schema**:
- All columns from `CampaignConfig` model implemented
- All columns from `CampaignConfigHistory` model implemented
- Foreign key relationship to `campaigns` table
- Correct data types and defaults
- Proper indexes and constraints

**✓ Non-Destructive**:
- Only CREATE statements
- No DROP or ALTER existing tables
- No data modification
- Safe for production application

## Next Steps

1. **Phase 2**: Apply migration with `npx prisma migrate deploy`
2. **Phase 3**: Backfill existing campaigns with default config records
3. **Phase 4-7**: Validate APIs, admin panel, and public flows

**Migration Status**: ✅ READY FOR APPLICATION