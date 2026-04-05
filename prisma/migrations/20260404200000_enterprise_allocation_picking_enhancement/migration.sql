-- Enterprise allocation & picking: enum extensions, plan/line columns, audit events table.
-- Non-destructive: additive only.

-- PostgreSQL: new enum values must be committed before use; Prisma runs one migration per file.
ALTER TYPE "AllocationPlanStatus" ADD VALUE 'ALLOCATED';
ALTER TYPE "AllocationPlanStatus" ADD VALUE 'PARTIALLY_ALLOCATED';
ALTER TYPE "AllocationPlanStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "AllocationPlanStatus" ADD VALUE 'FAILED';

ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "totalDemandQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "totalAllocatedQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "shortageQty" INTEGER;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "allocation_plans" ADD COLUMN IF NOT EXISTS "allocationMethod" VARCHAR(32);

ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "demandQty" INTEGER;
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "quantityShort" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "lineStatus" VARCHAR(32);
ALTER TABLE "allocation_plan_lines" ADD COLUMN IF NOT EXISTS "allocationMethod" VARCHAR(32);

CREATE TABLE IF NOT EXISTS "allocation_plan_events" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "allocationPlanId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "fromStatus" VARCHAR(32),
    "toStatus" VARCHAR(32),
    "metadata" JSONB,
    "performedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_plan_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "allocation_plan_events_orgId_idx" ON "allocation_plan_events"("orgId");
CREATE INDEX IF NOT EXISTS "allocation_plan_events_allocationPlanId_createdAt_idx" ON "allocation_plan_events"("allocationPlanId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_orgId_fkey'
  ) THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_allocationPlanId_fkey'
  ) THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_allocationPlanId_fkey"
      FOREIGN KEY ("allocationPlanId") REFERENCES "allocation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'allocation_plan_events_performedByUserId_fkey'
  ) THEN
    ALTER TABLE "allocation_plan_events" ADD CONSTRAINT "allocation_plan_events_performedByUserId_fkey"
      FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
