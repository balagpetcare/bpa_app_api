-- Additive: link retail product variants to clinical item variants; trace clinical batch rows back to product lots / GRN / dispatch / clinical transfer.

ALTER TABLE "clinical_item_variants" ADD COLUMN IF NOT EXISTS "productVariantId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "clinical_item_variants_productVariantId_key" ON "clinical_item_variants"("productVariantId");

ALTER TABLE "clinical_item_variants" DROP CONSTRAINT IF EXISTS "clinical_item_variants_productVariantId_fkey";
ALTER TABLE "clinical_item_variants"
  ADD CONSTRAINT "clinical_item_variants_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "branch_item_batches" ADD COLUMN IF NOT EXISTS "sourceStockLotId" INTEGER;
ALTER TABLE "branch_item_batches" ADD COLUMN IF NOT EXISTS "sourceGrnLineId" INTEGER;
ALTER TABLE "branch_item_batches" ADD COLUMN IF NOT EXISTS "sourceStockDispatchItemId" INTEGER;
ALTER TABLE "branch_item_batches" ADD COLUMN IF NOT EXISTS "sourceClinicalTransferItemId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "branch_item_batches_sourceGrnLineId_key" ON "branch_item_batches"("sourceGrnLineId");
CREATE UNIQUE INDEX IF NOT EXISTS "branch_item_batches_sourceStockDispatchItemId_key" ON "branch_item_batches"("sourceStockDispatchItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "branch_item_batches_sourceClinicalTransferItemId_key" ON "branch_item_batches"("sourceClinicalTransferItemId");

CREATE INDEX IF NOT EXISTS "branch_item_batches_sourceStockLotId_idx" ON "branch_item_batches"("sourceStockLotId");

ALTER TABLE "branch_item_batches" DROP CONSTRAINT IF EXISTS "branch_item_batches_sourceStockLotId_fkey";
ALTER TABLE "branch_item_batches" DROP CONSTRAINT IF EXISTS "branch_item_batches_sourceGrnLineId_fkey";
ALTER TABLE "branch_item_batches" DROP CONSTRAINT IF EXISTS "branch_item_batches_sourceStockDispatchItemId_fkey";
ALTER TABLE "branch_item_batches" DROP CONSTRAINT IF EXISTS "branch_item_batches_sourceClinicalTransferItemId_fkey";

ALTER TABLE "branch_item_batches"
  ADD CONSTRAINT "branch_item_batches_sourceStockLotId_fkey"
  FOREIGN KEY ("sourceStockLotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_item_batches"
  ADD CONSTRAINT "branch_item_batches_sourceGrnLineId_fkey"
  FOREIGN KEY ("sourceGrnLineId") REFERENCES "grn_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_item_batches"
  ADD CONSTRAINT "branch_item_batches_sourceStockDispatchItemId_fkey"
  FOREIGN KEY ("sourceStockDispatchItemId") REFERENCES "stock_dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_item_batches"
  ADD CONSTRAINT "branch_item_batches_sourceClinicalTransferItemId_fkey"
  FOREIGN KEY ("sourceClinicalTransferItemId") REFERENCES "clinical_stock_transfer_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
