-- Clinic Pharmacy Phase 2: DispenseRequestItem clinicalItemVariantId
ALTER TABLE "dispense_request_items" ADD COLUMN IF NOT EXISTS "clinicalItemVariantId" INTEGER;
CREATE INDEX IF NOT EXISTS "dispense_request_items_clinicalItemVariantId_idx" ON "dispense_request_items"("clinicalItemVariantId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispense_request_items_clinicalItemVariantId_fkey'
  ) THEN
    ALTER TABLE "dispense_request_items" ADD CONSTRAINT "dispense_request_items_clinicalItemVariantId_fkey"
      FOREIGN KEY ("clinicalItemVariantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
