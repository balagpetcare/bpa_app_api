-- Repair: ensure vendors.status is VendorStatus enum (idempotent).
-- Use when DB still has TEXT (e.g. vendor_module_enterprise migration not applied or failed partway).

-- Create enum if not exists (PostgreSQL has no CREATE TYPE IF NOT EXISTS; use exception handling)
DO $$
BEGIN
  CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Convert column to VendorStatus if it is not already (works for both TEXT and existing enum)
ALTER TABLE "vendors" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "vendors" ALTER COLUMN "status" TYPE "VendorStatus" USING (
  CASE "status"::text
    WHEN 'ACTIVE' THEN 'ACTIVE'::"VendorStatus"
    WHEN 'INACTIVE' THEN 'INACTIVE'::"VendorStatus"
    WHEN 'BLACKLISTED' THEN 'BLACKLISTED'::"VendorStatus"
    ELSE 'ACTIVE'::"VendorStatus"
  END
);
ALTER TABLE "vendors" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"VendorStatus";
