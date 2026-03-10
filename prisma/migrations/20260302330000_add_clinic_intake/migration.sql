-- AlterEnum
ALTER TYPE "AppointmentSource" ADD VALUE 'PHONE';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "intakeStatus" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED';

-- AlterTable
ALTER TABLE "visits" ADD COLUMN "treatmentCode" VARCHAR(32);

-- CreateTable
CREATE TABLE "clinic_intakes" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "chiefComplaint" TEXT,
    "complaintDuration" VARCHAR(128),
    "complaintOnset" VARCHAR(32),
    "symptomsJson" JSONB,
    "additionalSymptoms" TEXT,
    "weightKg" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "heartRate" INTEGER,
    "respRate" INTEGER,
    "hydrationStatus" VARCHAR(32),
    "feedingJson" JSONB,
    "historyJson" JSONB,
    "riskFlagsJson" JSONB,
    "documentsJson" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED',
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_intakes_appointmentId_key" ON "clinic_intakes"("appointmentId");

-- CreateIndex
CREATE INDEX "clinic_intakes_branchId_status_idx" ON "clinic_intakes"("branchId", "status");

-- AddForeignKey
ALTER TABLE "clinic_intakes" ADD CONSTRAINT "clinic_intakes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_intakes" ADD CONSTRAINT "clinic_intakes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_intakes" ADD CONSTRAINT "clinic_intakes_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
