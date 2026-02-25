-- Phase 4: generic policy rules table

CREATE TABLE "policy_rules" (
  "id" SERIAL PRIMARY KEY,
  "countryPolicyId" INTEGER NOT NULL,
  "ruleKey" VARCHAR(191) NOT NULL,
  "valueJson" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "policy_rules"
ADD CONSTRAINT "policy_rules_countryPolicyId_fkey"
FOREIGN KEY ("countryPolicyId") REFERENCES "country_policies"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "policy_rules_countryPolicyId_ruleKey_key" ON "policy_rules"("countryPolicyId", "ruleKey");
CREATE INDEX "policy_rules_countryPolicyId_idx" ON "policy_rules"("countryPolicyId");

