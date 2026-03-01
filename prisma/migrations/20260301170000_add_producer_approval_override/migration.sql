-- Phase 3: Add compliance override fields to producer_approvals (additive)
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "overrideNote" TEXT;
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "overrideAt" TIMESTAMP(3);
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "overrideByUserId" INTEGER;
