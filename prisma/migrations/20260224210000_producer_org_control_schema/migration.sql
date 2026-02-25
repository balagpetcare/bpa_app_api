-- Producer Organization Control: factories freeze, permission templates, staff-factory assignment, audit factoryId, product editLocked, batch isFrozen, batch status enum

-- 1. producer_factories: add isFrozen
ALTER TABLE "producer_factories" ADD COLUMN IF NOT EXISTS "isFrozen" BOOLEAN NOT NULL DEFAULT false;

-- 2. producer_permission_templates table
CREATE TABLE IF NOT EXISTS "producer_permission_templates" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" INTEGER NOT NULL,
    "factoryIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_permission_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "producer_permission_templates_producerOrgId_name_key" ON "producer_permission_templates"("producerOrgId", "name");
CREATE INDEX IF NOT EXISTS "producer_permission_templates_producerOrgId_idx" ON "producer_permission_templates"("producerOrgId");

ALTER TABLE "producer_permission_templates" ADD CONSTRAINT "producer_permission_templates_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producer_permission_templates" ADD CONSTRAINT "producer_permission_templates_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. producer_org_staff_factories (staff–factory assignment)
CREATE TABLE IF NOT EXISTS "producer_org_staff_factories" (
    "id" SERIAL NOT NULL,
    "producerOrgStaffId" INTEGER NOT NULL,
    "producerFactoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_org_staff_factories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "producer_org_staff_factories_producerOrgStaffId_producerFactoryId_key" ON "producer_org_staff_factories"("producerOrgStaffId", "producerFactoryId");
CREATE INDEX IF NOT EXISTS "producer_org_staff_factories_producerOrgStaffId_idx" ON "producer_org_staff_factories"("producerOrgStaffId");
CREATE INDEX IF NOT EXISTS "producer_org_staff_factories_producerFactoryId_idx" ON "producer_org_staff_factories"("producerFactoryId");

ALTER TABLE "producer_org_staff_factories" ADD CONSTRAINT "producer_org_staff_factories_producerOrgStaffId_fkey" FOREIGN KEY ("producerOrgStaffId") REFERENCES "producer_org_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producer_org_staff_factories" ADD CONSTRAINT "producer_org_staff_factories_producerFactoryId_fkey" FOREIGN KEY ("producerFactoryId") REFERENCES "producer_factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. producer_staff_invites: add factoryIds
ALTER TABLE "producer_staff_invites" ADD COLUMN IF NOT EXISTS "factoryIds" JSONB;

-- 5. producer_audit_logs: add factoryId
ALTER TABLE "producer_audit_logs" ADD COLUMN IF NOT EXISTS "factoryId" INTEGER;
CREATE INDEX IF NOT EXISTS "producer_audit_logs_factoryId_idx" ON "producer_audit_logs"("factoryId");

-- 6. auth_products: add editLocked
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "editLocked" BOOLEAN NOT NULL DEFAULT false;

-- 7. auth_batches: add isFrozen
ALTER TABLE "auth_batches" ADD COLUMN IF NOT EXISTS "isFrozen" BOOLEAN NOT NULL DEFAULT false;

-- 8. AuthBatchStatus enum: add IN_PRODUCTION, QC_PENDING, LOCKED (if not present; run each ADD VALUE once)
ALTER TYPE "AuthBatchStatus" ADD VALUE IF NOT EXISTS 'IN_PRODUCTION';
ALTER TYPE "AuthBatchStatus" ADD VALUE IF NOT EXISTS 'QC_PENDING';
ALTER TYPE "AuthBatchStatus" ADD VALUE IF NOT EXISTS 'LOCKED';
