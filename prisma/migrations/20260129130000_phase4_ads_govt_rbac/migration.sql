-- Phase 4: Ads + Govt Reporting (structure) + RBAC (Global/Country roles)
-- Reference: docs/GLOBAL_READY_FULL_PLANNING.md

-- RoleScope: add GLOBAL, COUNTRY (keep ORG, BRANCH)
-- Add new enum values (ignore error if already present)
DO $$ BEGIN
  ALTER TYPE "RoleScope" ADD VALUE 'GLOBAL';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "RoleScope" ADD VALUE 'COUNTRY';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Policy ads rules (optional per-country ads policy)
CREATE TABLE IF NOT EXISTS "policy_ads_rules" (
    "id" SERIAL NOT NULL,
    "countryPolicyId" INTEGER NOT NULL,
    "ruleType" TEXT NOT NULL,
    "valueJson" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_ads_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "policy_ads_rules_countryPolicyId_idx" ON "policy_ads_rules"("countryPolicyId");
ALTER TABLE "policy_ads_rules" ADD CONSTRAINT "policy_ads_rules_countryPolicyId_fkey" FOREIGN KEY ("countryPolicyId") REFERENCES "country_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ads (country targeting)
CREATE TABLE IF NOT EXISTS "ads" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "mediaId" INTEGER,
    "linkUrl" VARCHAR(512),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "targetCountryCodes" VARCHAR(255),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ads_countryId_status_idx" ON "ads"("countryId", "status");
CREATE INDEX IF NOT EXISTS "ads_status_dates_idx" ON "ads"("status", "startAt", "endAt");
ALTER TABLE "ads" ADD CONSTRAINT "ads_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ads" ADD CONSTRAINT "ads_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- User global roles (SUPER_ADMIN, COMPLIANCE_ADMIN, PLATFORM_FINANCE)
CREATE TABLE IF NOT EXISTS "user_global_roles" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_global_roles_pkey" PRIMARY KEY ("userId","roleId")
);
CREATE INDEX IF NOT EXISTS "user_global_roles_roleId_idx" ON "user_global_roles"("roleId");
ALTER TABLE "user_global_roles" ADD CONSTRAINT "user_global_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_global_roles" ADD CONSTRAINT "user_global_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- User country roles (COUNTRY_ADMIN, COUNTRY_COMPLIANCE, etc.)
CREATE TABLE IF NOT EXISTS "user_country_roles" (
    "userId" INTEGER NOT NULL,
    "countryId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_country_roles_pkey" PRIMARY KEY ("userId","countryId","roleId")
);
CREATE INDEX IF NOT EXISTS "user_country_roles_countryId_idx" ON "user_country_roles"("countryId");
CREATE INDEX IF NOT EXISTS "user_country_roles_roleId_idx" ON "user_country_roles"("roleId");
ALTER TABLE "user_country_roles" ADD CONSTRAINT "user_country_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_country_roles" ADD CONSTRAINT "user_country_roles_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_country_roles" ADD CONSTRAINT "user_country_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
