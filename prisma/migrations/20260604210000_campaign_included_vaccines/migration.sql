-- Campaign branded vaccine display (public booking / landing)
CREATE TABLE "campaign_included_vaccines" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coveredDiseases" JSONB NOT NULL DEFAULT '[]',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_included_vaccines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_included_vaccines_campaignId_displayOrder_idx"
    ON "campaign_included_vaccines"("campaignId", "displayOrder");

ALTER TABLE "campaign_included_vaccines"
    ADD CONSTRAINT "campaign_included_vaccines_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
