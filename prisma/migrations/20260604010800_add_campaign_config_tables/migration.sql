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