-- Producer Staff: status lifecycle (INVITED, ACTIVE, SUSPENDED, REMOVED) and audit log

-- CreateEnum
CREATE TYPE "ProducerOrgStaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- AlterTable producer_org_staff: add status with default ACTIVE
ALTER TABLE "producer_org_staff" ADD COLUMN "status" "ProducerOrgStaffStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "producer_org_staff_status_idx" ON "producer_org_staff"("status");

-- CreateTable producer_audit_logs
CREATE TABLE "producer_audit_logs" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producer_audit_logs_producerOrgId_idx" ON "producer_audit_logs"("producerOrgId");
CREATE INDEX "producer_audit_logs_actorId_idx" ON "producer_audit_logs"("actorId");
CREATE INDEX "producer_audit_logs_createdAt_idx" ON "producer_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "producer_audit_logs" ADD CONSTRAINT "producer_audit_logs_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
