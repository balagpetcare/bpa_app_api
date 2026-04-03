-- Doctor–service assignment templates (enterprise assignment UI)
CREATE TABLE "doctor_service_assignment_templates" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "scope" VARCHAR(16) NOT NULL DEFAULT 'BRANCH',
    "branchMemberId" INTEGER,
    "payload" JSONB NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_service_assignment_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "doctor_service_assignment_templates_branchId_idx" ON "doctor_service_assignment_templates"("branchId");
CREATE INDEX "doctor_service_assignment_templates_branchId_branchMemberId_idx" ON "doctor_service_assignment_templates"("branchId", "branchMemberId");

ALTER TABLE "doctor_service_assignment_templates" ADD CONSTRAINT "doctor_service_assignment_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
