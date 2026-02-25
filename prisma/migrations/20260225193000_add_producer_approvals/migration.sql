CREATE TYPE "ProducerApprovalEntityType" AS ENUM ('PRODUCT', 'BATCH');
CREATE TYPE "ProducerApprovalStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "producer_approvals" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "entityType" "ProducerApprovalEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "status" "ProducerApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "producer_approvals_unique_entity" ON "producer_approvals"("producerOrgId", "entityType", "entityId");
CREATE INDEX "producer_approvals_producerOrgId_status_idx" ON "producer_approvals"("producerOrgId", "status");
CREATE INDEX "producer_approvals_producerOrgId_entityType_idx" ON "producer_approvals"("producerOrgId", "entityType");

ALTER TABLE "producer_approvals" ADD CONSTRAINT "producer_approvals_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

