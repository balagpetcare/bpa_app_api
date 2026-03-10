-- AlterTable: consumption_items - add clinical item support and make variantId optional
ALTER TABLE "consumption_items" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "consumption_items" ADD COLUMN IF NOT EXISTS "clinicalItemId" INTEGER;
ALTER TABLE "consumption_items" ADD COLUMN IF NOT EXISTS "clinicalItemVariantId" INTEGER;
ALTER TABLE "consumption_items" ADD COLUMN IF NOT EXISTS "batchId" INTEGER;
ALTER TABLE "consumption_items" ADD COLUMN IF NOT EXISTS "consumptionSource" VARCHAR(32);

-- Add foreign keys for new columns (consumption_items)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consumption_items_clinicalItemId_fkey') THEN
    ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_clinicalItemId_fkey"
      FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consumption_items_clinicalItemVariantId_fkey') THEN
    ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_clinicalItemVariantId_fkey"
      FOREIGN KEY ("clinicalItemVariantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consumption_items_batchId_fkey') THEN
    ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "branch_item_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "consumption_items_clinicalItemId_idx" ON "consumption_items"("clinicalItemId");
CREATE INDEX IF NOT EXISTS "consumption_items_clinicalItemVariantId_idx" ON "consumption_items"("clinicalItemVariantId");

-- CreateTable: clinical_stock_ledger
CREATE TABLE IF NOT EXISTS "clinical_stock_ledger" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "batchId" INTEGER,
    "txnType" VARCHAR(48) NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "refType" VARCHAR(32),
    "refId" VARCHAR(64),
    "note" VARCHAR(512),
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_stock_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_stock_ledger_orgId_idx" ON "clinical_stock_ledger"("orgId");
CREATE INDEX IF NOT EXISTS "clinical_stock_ledger_branchId_idx" ON "clinical_stock_ledger"("branchId");
CREATE INDEX IF NOT EXISTS "clinical_stock_ledger_clinicalItemId_idx" ON "clinical_stock_ledger"("clinicalItemId");
CREATE INDEX IF NOT EXISTS "clinical_stock_ledger_variantId_idx" ON "clinical_stock_ledger"("variantId");
CREATE INDEX IF NOT EXISTS "clinical_stock_ledger_createdAt_idx" ON "clinical_stock_ledger"("createdAt");

ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_orgId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_branchId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_clinicalItemId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_variantId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_batchId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "branch_item_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_ledger" DROP CONSTRAINT IF EXISTS "clinical_stock_ledger_actorId_fkey";
ALTER TABLE "clinical_stock_ledger" ADD CONSTRAINT "clinical_stock_ledger_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
