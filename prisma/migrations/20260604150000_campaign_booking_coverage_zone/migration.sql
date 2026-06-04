-- Campaign Location Booking V2: persist Dhaka metro coverage on bookings
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "coverageZoneId" INTEGER;
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "bookingArea" VARCHAR(200);

CREATE INDEX IF NOT EXISTS "campaign_bookings_coverageZoneId_idx" ON "campaign_bookings"("coverageZoneId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_bookings_coverageZoneId_fkey'
  ) THEN
    ALTER TABLE "campaign_bookings"
      ADD CONSTRAINT "campaign_bookings_coverageZoneId_fkey"
      FOREIGN KEY ("coverageZoneId") REFERENCES "coverage_zones"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
