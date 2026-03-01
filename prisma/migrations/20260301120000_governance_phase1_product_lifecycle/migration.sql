-- Governance Phase 1: Product lifecycle (CHANGES_REQUESTED, ARCHIVED), ProducerApproval reviewer/SLA, ProductRevision
-- AlterEnum AuthProductStatus
ALTER TYPE "AuthProductStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';
ALTER TYPE "AuthProductStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- AlterTable producer_approvals: reviewer lock + SLA + stage
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "assignedToUserId" INTEGER;
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "slaDeadline" TIMESTAMP(3);
ALTER TABLE "producer_approvals" ADD COLUMN IF NOT EXISTS "stage" VARCHAR(32);

CREATE INDEX "producer_approvals_assignedToUserId_idx" ON "producer_approvals"("assignedToUserId");
CREATE INDEX "producer_approvals_slaDeadline_idx" ON "producer_approvals"("slaDeadline");
CREATE INDEX "producer_approvals_stage_idx" ON "producer_approvals"("stage");

-- CreateTable product_revisions
CREATE TABLE "product_revisions" (
    "id" SERIAL NOT NULL,
    "authProductId" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "submittedByUserId" INTEGER NOT NULL,
    "approvalId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_revisions_authProductId_revisionNumber_key" ON "product_revisions"("authProductId", "revisionNumber");
CREATE INDEX "product_revisions_authProductId_idx" ON "product_revisions"("authProductId");
CREATE INDEX "product_revisions_approvalId_idx" ON "product_revisions"("approvalId");

ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_authProductId_fkey" FOREIGN KEY ("authProductId") REFERENCES "auth_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
