-- Vendor Module (enterprise): enums, extend vendors, VendorContact, VendorAttachment, VendorLedgerEntry

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('DISTRIBUTOR', 'WHOLESALER', 'IMPORTER', 'LOCAL', 'MANUFACTURER', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "VendorAttachmentType" AS ENUM ('TRADE_LICENSE', 'INVOICE', 'CHALLAN', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorLedgerSourceType" AS ENUM ('PURCHASE_ORDER', 'GRN', 'PAYMENT', 'ADJUSTMENT', 'RETURN');

-- AlterTable vendors: add new columns
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "district" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "vendorType" "VendorType" DEFAULT 'OTHER';
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "defaultPaymentTermsDays" INTEGER;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(12,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Migrate status from TEXT to VendorStatus enum
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

-- Unique (orgId, code) - multiple NULL code allowed in PostgreSQL
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_orgId_code_key" ON "vendors"("orgId", "code");

-- Index for list/search
CREATE INDEX IF NOT EXISTS "vendors_orgId_name_idx" ON "vendors"("orgId", "name");

-- CreateTable vendor_contacts
CREATE TABLE "vendor_contacts" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "designation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_contacts_vendorId_idx" ON "vendor_contacts"("vendorId");

ALTER TABLE "vendor_contacts" ADD CONSTRAINT "vendor_contacts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable vendor_attachments
CREATE TABLE "vendor_attachments" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "orgId" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "type" "VendorAttachmentType" NOT NULL DEFAULT 'OTHER',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_attachments_vendorId_idx" ON "vendor_attachments"("vendorId");
CREATE INDEX "vendor_attachments_orgId_idx" ON "vendor_attachments"("orgId");

ALTER TABLE "vendor_attachments" ADD CONSTRAINT "vendor_attachments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_attachments" ADD CONSTRAINT "vendor_attachments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable vendor_ledger_entries
CREATE TABLE "vendor_ledger_entries" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "orgId" INTEGER NOT NULL,
    "sourceType" "VendorLedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_ledger_entries_vendorId_idx" ON "vendor_ledger_entries"("vendorId");
CREATE INDEX "vendor_ledger_entries_orgId_idx" ON "vendor_ledger_entries"("orgId");
CREATE INDEX "vendor_ledger_entries_vendorId_createdAt_idx" ON "vendor_ledger_entries"("vendorId", "createdAt");

ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
