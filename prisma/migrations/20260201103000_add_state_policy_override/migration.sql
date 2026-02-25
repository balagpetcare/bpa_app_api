-- Phase 5: State/Province layer + overrides

CREATE TABLE "states" (
  "id" SERIAL PRIMARY KEY,
  "countryId" INTEGER NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(191) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "states"
ADD CONSTRAINT "states_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "countries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "states_countryId_code_key" ON "states"("countryId", "code");
CREATE INDEX "states_countryId_idx" ON "states"("countryId");

CREATE TABLE "state_policies" (
  "id" SERIAL PRIMARY KEY,
  "stateId" INTEGER NOT NULL,
  "name" VARCHAR(191) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "state_policies"
ADD CONSTRAINT "state_policies_stateId_fkey"
FOREIGN KEY ("stateId") REFERENCES "states"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "state_policies_stateId_status_idx" ON "state_policies"("stateId", "status");

CREATE TABLE "state_policy_features" (
  "id" SERIAL PRIMARY KEY,
  "statePolicyId" INTEGER NOT NULL,
  "featureCode" VARCHAR(191) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "state_policy_features"
ADD CONSTRAINT "state_policy_features_statePolicyId_fkey"
FOREIGN KEY ("statePolicyId") REFERENCES "state_policies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "state_policy_features_statePolicyId_featureCode_key"
ON "state_policy_features"("statePolicyId", "featureCode");
CREATE INDEX "state_policy_features_statePolicyId_idx" ON "state_policy_features"("statePolicyId");

CREATE TABLE "state_policy_rules" (
  "id" SERIAL PRIMARY KEY,
  "statePolicyId" INTEGER NOT NULL,
  "ruleKey" VARCHAR(191) NOT NULL,
  "valueJson" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "state_policy_rules"
ADD CONSTRAINT "state_policy_rules_statePolicyId_fkey"
FOREIGN KEY ("statePolicyId") REFERENCES "state_policies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "state_policy_rules_statePolicyId_ruleKey_key"
ON "state_policy_rules"("statePolicyId", "ruleKey");
CREATE INDEX "state_policy_rules_statePolicyId_idx" ON "state_policy_rules"("statePolicyId");

