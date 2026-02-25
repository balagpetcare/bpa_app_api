-- Standardized location (lat, lng, address, city, state, country, postalCode) for Organization and Branch.
-- Existing rows get default '{}'; no breaking change.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "location" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "location" JSONB NOT NULL DEFAULT '{}';
