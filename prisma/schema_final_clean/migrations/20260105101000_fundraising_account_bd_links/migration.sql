-- Add BD location foreign keys to fundraising_accounts
-- This fixes runtime errors when the Prisma schema expects these columns.

ALTER TABLE "fundraising_accounts" ADD COLUMN IF NOT EXISTS "divisionId" INTEGER;
ALTER TABLE "fundraising_accounts" ADD COLUMN IF NOT EXISTS "districtId" INTEGER;
ALTER TABLE "fundraising_accounts" ADD COLUMN IF NOT EXISTS "upazilaId" INTEGER;
ALTER TABLE "fundraising_accounts" ADD COLUMN IF NOT EXISTS "areaId" INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS "fundraising_accounts_divisionId_idx" ON "fundraising_accounts"("divisionId");
CREATE INDEX IF NOT EXISTS "fundraising_accounts_districtId_idx" ON "fundraising_accounts"("districtId");
CREATE INDEX IF NOT EXISTS "fundraising_accounts_upazilaId_idx" ON "fundraising_accounts"("upazilaId");
CREATE INDEX IF NOT EXISTS "fundraising_accounts_areaId_idx" ON "fundraising_accounts"("areaId");

-- Foreign keys (idempotent-ish: drop if exists then add)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_accounts_divisionId_fkey') THEN
    ALTER TABLE "fundraising_accounts" DROP CONSTRAINT "fundraising_accounts_divisionId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_accounts_districtId_fkey') THEN
    ALTER TABLE "fundraising_accounts" DROP CONSTRAINT "fundraising_accounts_districtId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_accounts_upazilaId_fkey') THEN
    ALTER TABLE "fundraising_accounts" DROP CONSTRAINT "fundraising_accounts_upazilaId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fundraising_accounts_areaId_fkey') THEN
    ALTER TABLE "fundraising_accounts" DROP CONSTRAINT "fundraising_accounts_areaId_fkey";
  END IF;
END $$;

ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "bd_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_upazilaId_fkey"
  FOREIGN KEY ("upazilaId") REFERENCES "bd_upazilas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "bd_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
