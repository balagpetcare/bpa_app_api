-- Vaccination V2 nullable references and idempotency support
-- Phase A-C only: additive nullable columns, enum, and indexes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'VaccinationRecordStatus'
  ) THEN
    CREATE TYPE "VaccinationRecordStatus" AS ENUM ('ACTIVE', 'CORRECTED', 'VOIDED');
  END IF;
END $$;

ALTER TABLE "vaccinations"
  ADD COLUMN IF NOT EXISTS "orgId" INTEGER,
  ADD COLUMN IF NOT EXISTS "branchId" INTEGER,
  ADD COLUMN IF NOT EXISTS "inventoryBatchId" INTEGER,
  ADD COLUMN IF NOT EXISTS "clinicalItemId" INTEGER,
  ADD COLUMN IF NOT EXISTS "clinicalItemVariantId" INTEGER,
  ADD COLUMN IF NOT EXISTS "stockLedgerId" INTEGER,
  ADD COLUMN IF NOT EXISTS "orderId" INTEGER,
  ADD COLUMN IF NOT EXISTS "invoiceId" INTEGER,
  ADD COLUMN IF NOT EXISTS "administeredByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "administeredByDoctorId" INTEGER,
  ADD COLUMN IF NOT EXISTS "administeredByStaffId" INTEGER,
  ADD COLUMN IF NOT EXISTS "correctionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "correctedByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT,
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidedByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "createdByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vaccinations'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE "vaccinations"
      ADD COLUMN "status" "VaccinationRecordStatus" NOT NULL DEFAULT 'ACTIVE';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "vaccinations_orgId_idx" ON "vaccinations"("orgId");
CREATE INDEX IF NOT EXISTS "vaccinations_branchId_idx" ON "vaccinations"("branchId");
CREATE INDEX IF NOT EXISTS "vaccinations_petId_status_idx" ON "vaccinations"("petId", "status");
CREATE INDEX IF NOT EXISTS "vaccinations_branchId_administeredAt_idx" ON "vaccinations"("branchId", "administeredAt");
CREATE INDEX IF NOT EXISTS "vaccinations_inventoryBatchId_idx" ON "vaccinations"("inventoryBatchId");
CREATE INDEX IF NOT EXISTS "vaccinations_stockLedgerId_idx" ON "vaccinations"("stockLedgerId");
CREATE INDEX IF NOT EXISTS "vaccinations_orderId_idx" ON "vaccinations"("orderId");
CREATE INDEX IF NOT EXISTS "vaccinations_idempotencyKey_idx" ON "vaccinations"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "vaccinations_branchId_idempotencyKey_idx" ON "vaccinations"("branchId", "idempotencyKey");
