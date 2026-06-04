-- Enterprise GRN: PO line link, barcodes, void, idempotency, warehouse over-receipt tolerance, lot supplier barcode.

-- GrnStatus: VOIDED
DO $$ BEGIN
  ALTER TYPE "GrnStatus" ADD VALUE 'VOIDED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- warehouses (table created in 20260428150000; this migration timestamp runs earlier)
DO $$
BEGIN
  IF to_regclass('public.warehouses') IS NOT NULL THEN
    ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "poOverReceiptTolerancePercent" DECIMAL(5,2);
  END IF;
END $$;

-- grns
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "receiveIdempotencyKey" VARCHAR(64);
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "voidedByUserId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grns_voidedByUserId_fkey'
  ) THEN
    ALTER TABLE "grns" ADD CONSTRAINT "grns_voidedByUserId_fkey"
      FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "grns_orgId_receiveIdempotencyKey_key"
  ON "grns" ("orgId", "receiveIdempotencyKey");

-- grn_lines
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "purchaseOrderLineId" INTEGER;
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "landedUnitCost" DECIMAL(12,4);
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "supplierBarcode" VARCHAR(128);
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "receiveBarcode" VARCHAR(128);
ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "lineRemarks" TEXT;

-- FK target `purchase_order_lines` is created in 20260429120000 (this migration is dated earlier).
DO $$
BEGIN
  IF to_regclass('public.purchase_order_lines') IS NOT NULL
     AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grn_lines_purchaseOrderLineId_fkey'
  ) THEN
    ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_purchaseOrderLineId_fkey"
      FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "grn_lines_purchaseOrderLineId_idx" ON "grn_lines" ("purchaseOrderLineId");

-- stock_lots
ALTER TABLE "stock_lots" ADD COLUMN IF NOT EXISTS "supplierBarcode" VARCHAR(128);
