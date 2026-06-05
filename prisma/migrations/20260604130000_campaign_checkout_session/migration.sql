-- Campaign checkout sessions (idempotent — safe after partial apply / enum pre-exists from failed run)

DO $$
BEGIN
  CREATE TYPE "CampaignCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'EXPIRED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campaign_rollout_regions" ADD COLUMN IF NOT EXISTS "bookedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "rolloutRegionId" INTEGER;
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "checkoutSessionId" VARCHAR(32);
ALTER TABLE "campaign_bookings" ADD COLUMN IF NOT EXISTS "ownerAlternatePhone" VARCHAR(15);

CREATE TABLE IF NOT EXISTS "campaign_checkout_sessions" (
    "id" TEXT NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "rolloutRegionId" INTEGER,
    "ownerPhone" VARCHAR(15) NOT NULL,
    "alternatePhone" VARCHAR(15),
    "addressJson" JSONB NOT NULL,
    "catCount" INTEGER NOT NULL,
    "couponCode" VARCHAR(32),
    "paymentMethod" VARCHAR(20),
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CampaignCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" INTEGER,
    "bookingId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaign_bookings_rolloutRegionId_idx" ON "campaign_bookings"("rolloutRegionId");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_bookings_checkoutSessionId_key" ON "campaign_bookings"("checkoutSessionId");
CREATE INDEX IF NOT EXISTS "campaign_checkout_sessions_ownerPhone_idx" ON "campaign_checkout_sessions"("ownerPhone");
CREATE INDEX IF NOT EXISTS "campaign_checkout_sessions_status_expiresAt_idx" ON "campaign_checkout_sessions"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "campaign_checkout_sessions_campaignId_idx" ON "campaign_checkout_sessions"("campaignId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_bookings_rolloutRegionId_fkey') THEN
    ALTER TABLE "campaign_bookings"
      ADD CONSTRAINT "campaign_bookings_rolloutRegionId_fkey"
      FOREIGN KEY ("rolloutRegionId") REFERENCES "campaign_rollout_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_bookings_checkoutSessionId_fkey') THEN
    ALTER TABLE "campaign_bookings"
      ADD CONSTRAINT "campaign_bookings_checkoutSessionId_fkey"
      FOREIGN KEY ("checkoutSessionId") REFERENCES "campaign_checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_checkout_sessions_campaignId_fkey') THEN
    ALTER TABLE "campaign_checkout_sessions"
      ADD CONSTRAINT "campaign_checkout_sessions_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_checkout_sessions_rolloutRegionId_fkey') THEN
    ALTER TABLE "campaign_checkout_sessions"
      ADD CONSTRAINT "campaign_checkout_sessions_rolloutRegionId_fkey"
      FOREIGN KEY ("rolloutRegionId") REFERENCES "campaign_rollout_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_checkout_sessions_orderId_fkey') THEN
    ALTER TABLE "campaign_checkout_sessions"
      ADD CONSTRAINT "campaign_checkout_sessions_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
