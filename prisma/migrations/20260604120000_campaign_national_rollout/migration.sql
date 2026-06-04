-- National phased rollout + pre-registration

CREATE TYPE "CampaignRolloutPhaseStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');
CREATE TYPE "CampaignRolloutPhaseCode" AS ENUM ('PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4');
CREATE TYPE "CampaignPreRegistrationStatus" AS ENUM ('WAITING', 'NOTIFIED', 'CONVERTED', 'CANCELLED');

CREATE TABLE "campaign_rollout_phases" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "phaseCode" "CampaignRolloutPhaseCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignRolloutPhaseStatus" NOT NULL DEFAULT 'PLANNED',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nationwideGoalPets" INTEGER NOT NULL DEFAULT 10000,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_rollout_phases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaign_rollout_regions" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "divisionId" INTEGER,
    "districtId" INTEGER,
    "upazilaId" INTEGER,
    "city" TEXT,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "locationId" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "targetCapacity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_rollout_regions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campaign_pre_registrations" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "regionId" INTEGER,
    "divisionId" INTEGER,
    "districtId" INTEGER,
    "upazilaId" INTEGER,
    "phone" VARCHAR(20) NOT NULL,
    "catCount" INTEGER NOT NULL DEFAULT 1,
    "status" "CampaignPreRegistrationStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pre_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_rollout_phases_campaignId_phaseCode_key" ON "campaign_rollout_phases"("campaignId", "phaseCode");
CREATE INDEX "campaign_rollout_phases_campaignId_status_idx" ON "campaign_rollout_phases"("campaignId", "status");
CREATE INDEX "campaign_rollout_regions_campaignId_isActive_idx" ON "campaign_rollout_regions"("campaignId", "isActive");
CREATE INDEX "campaign_rollout_regions_phaseId_idx" ON "campaign_rollout_regions"("phaseId");
CREATE INDEX "campaign_rollout_regions_divisionId_districtId_upazilaId_idx" ON "campaign_rollout_regions"("divisionId", "districtId", "upazilaId");
CREATE INDEX "campaign_pre_registrations_campaignId_status_idx" ON "campaign_pre_registrations"("campaignId", "status");
CREATE INDEX "campaign_pre_registrations_phone_idx" ON "campaign_pre_registrations"("phone");
CREATE INDEX "campaign_pre_registrations_districtId_idx" ON "campaign_pre_registrations"("districtId");

ALTER TABLE "campaign_rollout_phases" ADD CONSTRAINT "campaign_rollout_phases_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_rollout_regions" ADD CONSTRAINT "campaign_rollout_regions_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "campaign_rollout_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_rollout_regions" ADD CONSTRAINT "campaign_rollout_regions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_rollout_regions" ADD CONSTRAINT "campaign_rollout_regions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "campaign_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "campaign_pre_registrations" ADD CONSTRAINT "campaign_pre_registrations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_pre_registrations" ADD CONSTRAINT "campaign_pre_registrations_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "campaign_rollout_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
