-- MedicineApprovalRequest: add approvedByUserId and approvedAt for override governance audit
ALTER TABLE "medicine_approval_requests" ADD COLUMN IF NOT EXISTS "approvedByUserId" INTEGER;
ALTER TABLE "medicine_approval_requests" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "medicine_approval_requests_approvedByUserId_idx" ON "medicine_approval_requests"("approvedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medicine_approval_requests_approvedByUserId_fkey'
  ) THEN
    ALTER TABLE "medicine_approval_requests"
      ADD CONSTRAINT "medicine_approval_requests_approvedByUserId_fkey"
      FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
