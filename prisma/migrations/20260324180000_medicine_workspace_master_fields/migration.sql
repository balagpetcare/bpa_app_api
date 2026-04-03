-- Medicine admin workspace: lifecycle fields on master entities + audit log

CREATE TABLE "medicine_master_audit_logs" (
    "id" SERIAL NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "medicine_master_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medicine_master_audit_logs_entityType_entityId_idx" ON "medicine_master_audit_logs"("entityType", "entityId");
CREATE INDEX "medicine_master_audit_logs_userId_createdAt_idx" ON "medicine_master_audit_logs"("userId", "createdAt");

ALTER TABLE "medicine_master_audit_logs" ADD CONSTRAINT "medicine_master_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lifecycle/workspace columns for medicine_generics, *_forms, *_manufacturers, *_brands, *_presentations, country_medicine_brands
-- were moved into CREATE TABLE in 20260403120000_medicine_catalog_import (those tables are created there; ALTER here broke shadow DB order).
