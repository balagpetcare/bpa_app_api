-- Trust & Safety / Enforcement: case-centric complaint and enforcement
-- Add quarantinedAt to auth_batches (block verifications when set)
ALTER TABLE "auth_batches" ADD COLUMN IF NOT EXISTS "quarantinedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "complaint_cases" (
    "id" SERIAL NOT NULL,
    "caseNo" VARCHAR(32) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" VARCHAR(128) NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    "severity" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    "summary" VARCHAR(256) NOT NULL,
    "details" TEXT,
    "assignedToUserId" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" INTEGER,
    "resolutionNote" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_evidence" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "url" TEXT,
    "note" TEXT,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enforcement_actions" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(128) NOT NULL,
    "actionType" VARCHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "meta" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'APPLIED',
    "appliedByUserId" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedByUserId" INTEGER,
    "revertedAt" TIMESTAMP(3),
    "revertNote" TEXT,

    CONSTRAINT "enforcement_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaint_cases_caseNo_key" ON "complaint_cases"("caseNo");

-- CreateIndex
CREATE INDEX "complaint_cases_producerOrgId_idx" ON "complaint_cases"("producerOrgId");

-- CreateIndex
CREATE INDEX "complaint_cases_entityType_entityId_idx" ON "complaint_cases"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "complaint_cases_status_idx" ON "complaint_cases"("status");

-- CreateIndex
CREATE INDEX "complaint_cases_severity_idx" ON "complaint_cases"("severity");

-- CreateIndex
CREATE INDEX "complaint_cases_caseNo_idx" ON "complaint_cases"("caseNo");

-- CreateIndex
CREATE INDEX "case_evidence_caseId_idx" ON "case_evidence"("caseId");

-- CreateIndex
CREATE INDEX "enforcement_actions_caseId_idx" ON "enforcement_actions"("caseId");

-- CreateIndex
CREATE INDEX "enforcement_actions_targetType_targetId_idx" ON "enforcement_actions"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "enforcement_actions_actionType_idx" ON "enforcement_actions"("actionType");

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_evidence" ADD CONSTRAINT "case_evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "complaint_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enforcement_actions" ADD CONSTRAINT "enforcement_actions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "complaint_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
