-- Phase 3: Branch coverage polygon + policy_payment_methods

-- BranchProfileDetails: coverage polygon (GeoJSON)
ALTER TABLE "branch_profile_details" ADD COLUMN IF NOT EXISTS "coveragePolygon" JSONB;

-- Policy payment methods
CREATE TABLE IF NOT EXISTS "policy_payment_methods" (
    "id" SERIAL NOT NULL,
    "countryPolicyId" INTEGER NOT NULL,
    "providerCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "policy_payment_methods_countryPolicyId_providerCode_key" ON "policy_payment_methods"("countryPolicyId", "providerCode");
CREATE INDEX IF NOT EXISTS "policy_payment_methods_countryPolicyId_idx" ON "policy_payment_methods"("countryPolicyId");

ALTER TABLE "policy_payment_methods" ADD CONSTRAINT "policy_payment_methods_countryPolicyId_fkey" FOREIGN KEY ("countryPolicyId") REFERENCES "country_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
