-- Clinic Pharmacy Phase 2: PrescriptionItem clinicalItemVariantId
ALTER TABLE "prescription_items" ADD COLUMN IF NOT EXISTS "clinicalItemVariantId" INTEGER;
CREATE INDEX IF NOT EXISTS "prescription_items_clinicalItemVariantId_idx" ON "prescription_items"("clinicalItemVariantId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prescription_items_clinicalItemVariantId_fkey'
  ) THEN
    ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_clinicalItemVariantId_fkey"
      FOREIGN KEY ("clinicalItemVariantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
