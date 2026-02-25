-- Global-Ready Phase 1: bind organizations to country

ALTER TABLE "organizations" ADD COLUMN "countryId" INTEGER;

-- Backfill existing organizations to BD if available
UPDATE "organizations"
SET "countryId" = (
  SELECT id FROM "countries" WHERE code = 'BD' LIMIT 1
)
WHERE "countryId" IS NULL;

-- Foreign key (keep nullable for backward compatibility)
ALTER TABLE "organizations"
ADD CONSTRAINT "organizations_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "organizations_countryId_idx" ON "organizations"("countryId");

