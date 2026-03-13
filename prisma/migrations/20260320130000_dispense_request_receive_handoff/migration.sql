-- Pharmacy → injection room handoff: record who received the issued dispense
ALTER TABLE "dispense_requests" ADD COLUMN IF NOT EXISTS "receivedByUserId" INTEGER;
ALTER TABLE "dispense_requests" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "dispense_requests_receivedByUserId_idx" ON "dispense_requests"("receivedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispense_requests_receivedByUserId_fkey') THEN
    ALTER TABLE "dispense_requests"
      ADD CONSTRAINT "dispense_requests_receivedByUserId_fkey"
      FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
