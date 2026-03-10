-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClinicalNoteType" AS ENUM ('SOAP', 'FOLLOW_UP', 'DISCHARGE', 'REFERRAL');

-- CreateTable
CREATE TABLE "visits" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "status" "VisitStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "followUpDate" TIMESTAMP(3),
    "followUpNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vital_records" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "heartRate" INTEGER,
    "respRate" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_notes" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "noteType" "ClinicalNoteType" NOT NULL,
    "contentJson" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_attachments" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" VARCHAR(256),
    "fileType" VARCHAR(64),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visits_appointmentId_key" ON "visits"("appointmentId");

-- CreateIndex
CREATE INDEX "visits_orgId_branchId_idx" ON "visits"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "visits_branchId_status_idx" ON "visits"("branchId", "status");

-- CreateIndex
CREATE INDEX "visits_petId_idx" ON "visits"("petId");

-- CreateIndex
CREATE INDEX "visits_patientId_idx" ON "visits"("patientId");

-- CreateIndex
CREATE INDEX "visits_doctorId_idx" ON "visits"("doctorId");

-- CreateIndex
CREATE INDEX "visits_appointmentId_idx" ON "visits"("appointmentId");

-- CreateIndex
CREATE INDEX "vital_records_visitId_idx" ON "vital_records"("visitId");

-- CreateIndex
CREATE INDEX "clinical_notes_visitId_idx" ON "clinical_notes"("visitId");

-- CreateIndex
CREATE INDEX "visit_attachments_visitId_idx" ON "visit_attachments"("visitId");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_records" ADD CONSTRAINT "vital_records_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "branch_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
