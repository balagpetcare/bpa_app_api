ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "bookingStartAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bookingEndAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "countdownEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "campaigns_bookingStartAt_bookingEndAt_idx"
  ON "campaigns"("bookingStartAt", "bookingEndAt");
