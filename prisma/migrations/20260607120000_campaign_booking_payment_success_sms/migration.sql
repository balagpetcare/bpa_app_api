-- Add idempotent payment-success SMS tracking on campaign bookings (additive, non-destructive).
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "smsSentAt" TIMESTAMP(3);
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "smsReference" VARCHAR(64);
