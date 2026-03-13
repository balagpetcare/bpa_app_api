-- Add enterprise fields to clinical_supply_requests
ALTER TABLE "clinical_supply_requests" ADD COLUMN IF NOT EXISTS "department" VARCHAR(64);
ALTER TABLE "clinical_supply_requests" ADD COLUMN IF NOT EXISTS "requestType" VARCHAR(32) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "clinical_supply_requests" ADD COLUMN IF NOT EXISTS "neededBy" TIMESTAMP(3);
ALTER TABLE "clinical_supply_requests" ADD COLUMN IF NOT EXISTS "reason" VARCHAR(1024);

-- Add enterprise fields to clinical_supply_request_items
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "sourceType" VARCHAR(32) NOT NULL DEFAULT 'CLINICAL_ITEM';
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "sourceId" INTEGER;
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "itemNameSnapshot" VARCHAR(256);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "itemCodeSnapshot" VARCHAR(64);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "unitSnapshot" VARCHAR(32);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "currentStockSnapshot" DECIMAL(12,4);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "reorderLevelSnapshot" DECIMAL(12,4);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "estimatedUnitCost" DECIMAL(12,2);
ALTER TABLE "clinical_supply_request_items" ADD COLUMN IF NOT EXISTS "lineNote" VARCHAR(512);

-- Allow clinicalItemId to be null for CUSTOM line items
ALTER TABLE "clinical_supply_request_items" ALTER COLUMN "clinicalItemId" DROP NOT NULL;

-- CreateTable: clinical_supply_request_status_history
CREATE TABLE IF NOT EXISTS "clinical_supply_request_status_history" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "fromStatus" VARCHAR(24),
    "toStatus" VARCHAR(24) NOT NULL,
    "message" VARCHAR(512) NOT NULL,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_supply_request_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_supply_request_status_history_requestId_idx" ON "clinical_supply_request_status_history"("requestId");
CREATE INDEX IF NOT EXISTS "clinical_supply_request_status_history_createdAt_idx" ON "clinical_supply_request_status_history"("createdAt");

ALTER TABLE "clinical_supply_request_status_history" ADD CONSTRAINT "clinical_supply_request_status_history_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "clinical_supply_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_supply_request_status_history" ADD CONSTRAINT "clinical_supply_request_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: ensure existing rows have requestType (already defaulted by column add)
UPDATE "clinical_supply_requests" SET "requestType" = 'MANUAL' WHERE "requestType" IS NULL;
