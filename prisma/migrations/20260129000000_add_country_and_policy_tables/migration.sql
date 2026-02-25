-- Global-Ready Phase 1: Country + Policy tables (BPA)
-- Reference: docs/GLOBAL_READY_FULL_PLANNING.md

-- CreateTable
CREATE TABLE "countries" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT DEFAULT 'USD',
    "timezoneDefault" TEXT DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_policies" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_features" (
    "id" SERIAL NOT NULL,
    "countryPolicyId" INTEGER NOT NULL,
    "featureCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_donation_rules" (
    "id" SERIAL NOT NULL,
    "countryPolicyId" INTEGER NOT NULL,
    "ruleType" TEXT NOT NULL,
    "maxAmountSingle" DECIMAL(18,2),
    "maxAmountDaily" DECIMAL(18,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_donation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE INDEX "country_policies_countryId_status_idx" ON "country_policies"("countryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "policy_features_countryPolicyId_featureCode_key" ON "policy_features"("countryPolicyId", "featureCode");

-- CreateIndex
CREATE INDEX "policy_features_countryPolicyId_idx" ON "policy_features"("countryPolicyId");

-- CreateIndex
CREATE INDEX "policy_donation_rules_countryPolicyId_idx" ON "policy_donation_rules"("countryPolicyId");

-- AddForeignKey
ALTER TABLE "country_policies" ADD CONSTRAINT "country_policies_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_features" ADD CONSTRAINT "policy_features_countryPolicyId_fkey" FOREIGN KEY ("countryPolicyId") REFERENCES "country_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_donation_rules" ADD CONSTRAINT "policy_donation_rules_countryPolicyId_fkey" FOREIGN KEY ("countryPolicyId") REFERENCES "country_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
