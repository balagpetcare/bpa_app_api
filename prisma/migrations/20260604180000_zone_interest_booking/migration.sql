-- Zone-interest booking: optional venue/slot, coverage zone + BdArea on booking

CREATE TYPE "CampaignBookingMode" AS ENUM ('VENUE', 'ZONE_INTEREST');

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
