-- Clinic Pharmacy Phase 2: DispenseRequest prescriptionId and transactionType
ALTER TABLE "dispense_requests" ADD COLUMN IF NOT EXISTS "prescriptionId" INTEGER;
ALTER TABLE "dispense_requests" ADD COLUMN IF NOT EXISTS "transactionType" VARCHAR(32);
CREATE INDEX IF NOT EXISTS "dispense_requests_prescriptionId_idx" ON "dispense_requests"("prescriptionId");
CREATE INDEX IF NOT EXISTS "dispense_requests_transactionType_idx" ON "dispense_requests"("transactionType");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispense_requests_prescriptionId_fkey'
  ) THEN
    ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_prescriptionId_fkey"
      FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
