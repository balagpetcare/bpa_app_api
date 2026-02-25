-- Country controller organization: Country.controllerOrgId, Organization.orgType
-- Non-breaking: all new columns nullable / default.

-- New enum for org type (partner vs country chapter)
CREATE TYPE "OrgType" AS ENUM ('PARTNER', 'COUNTRY_CHAPTER');

-- Add orgType to organizations (default PARTNER for existing rows)
ALTER TABLE "organizations" ADD COLUMN "orgType" "OrgType" DEFAULT 'PARTNER';

-- Add controllerOrgId to countries (nullable, unique so one org cannot control two countries)
ALTER TABLE "countries" ADD COLUMN "controllerOrgId" INTEGER;

ALTER TABLE "countries"
ADD CONSTRAINT "countries_controllerOrgId_fkey"
FOREIGN KEY ("controllerOrgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "countries_controllerOrgId_key" ON "countries"("controllerOrgId");
CREATE INDEX "countries_controllerOrgId_idx" ON "countries"("controllerOrgId");

-- Add index on organizations.orgType for filtering
CREATE INDEX "organizations_orgType_idx" ON "organizations"("orgType");

-- Audit: add COUNTRY to AuditEntityType for assign-controller audit entries
ALTER TYPE "AuditEntityType" ADD VALUE 'COUNTRY';
