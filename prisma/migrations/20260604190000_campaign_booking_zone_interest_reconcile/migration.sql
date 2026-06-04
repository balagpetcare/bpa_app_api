-- Idempotent reconcile: zone-interest booking columns on campaign_bookings
-- Safe on DBs that already applied 20260604180000_zone_interest_booking (no data loss).

DO $$
BEGIN
  CREATE TYPE "CampaignBookingMode" AS ENUM ('VENUE', 'ZONE_INTEREST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "CampaignBookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_ASSIGNMENT';

ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "bookingMode" "CampaignBookingMode" NOT NULL DEFAULT 'VENUE';

ALTER TABLE "campaign_bookings" ALTER COLUMN "locationId" DROP NOT NULL;
ALTER TABLE "campaign_bookings" ALTER COLUMN "slotId" DROP NOT NULL;

ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "coverageZoneName" VARCHAR(200);
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "bdAreaId" INTEGER;

CREATE INDEX IF NOT EXISTS "campaign_bookings_bdAreaId_idx" ON "campaign_bookings"("bdAreaId");
CREATE INDEX IF NOT EXISTS "campaign_bookings_bookingMode_idx" ON "campaign_bookings"("bookingMode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_bookings_bdAreaId_fkey'
  ) THEN
    ALTER TABLE "campaign_bookings"
      ADD CONSTRAINT "campaign_bookings_bdAreaId_fkey"
      FOREIGN KEY ("bdAreaId") REFERENCES "bd_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
