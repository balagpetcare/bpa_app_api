-- CreateEnum
CREATE TYPE "CampaignCheckoutStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "campaign_rollout_regions" ADD COLUMN "bookedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "campaign_bookings" ADD COLUMN "rolloutRegionId" INTEGER,
ADD COLUMN "checkoutSessionId" VARCHAR(32),
ADD COLUMN "ownerAlternatePhone" VARCHAR(15);

-- CreateTable
CREATE TABLE "campaign_checkout_sessions" (
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

-- CreateIndex
CREATE INDEX "campaign_bookings_rolloutRegionId_idx" ON "campaign_bookings"("rolloutRegionId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_bookings_checkoutSessionId_key" ON "campaign_bookings"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "campaign_checkout_sessions_ownerPhone_idx" ON "campaign_checkout_sessions"("ownerPhone");

-- CreateIndex
CREATE INDEX "campaign_checkout_sessions_status_expiresAt_idx" ON "campaign_checkout_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "campaign_checkout_sessions_campaignId_idx" ON "campaign_checkout_sessions"("campaignId");

-- AddForeignKey
ALTER TABLE "campaign_bookings" ADD CONSTRAINT "campaign_bookings_rolloutRegionId_fkey" FOREIGN KEY ("rolloutRegionId") REFERENCES "campaign_rollout_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_bookings" ADD CONSTRAINT "campaign_bookings_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "campaign_checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_checkout_sessions" ADD CONSTRAINT "campaign_checkout_sessions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_checkout_sessions" ADD CONSTRAINT "campaign_checkout_sessions_rolloutRegionId_fkey" FOREIGN KEY ("rolloutRegionId") REFERENCES "campaign_rollout_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_checkout_sessions" ADD CONSTRAINT "campaign_checkout_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
