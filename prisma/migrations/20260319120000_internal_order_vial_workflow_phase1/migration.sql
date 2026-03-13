-- CreateEnum
CREATE TYPE "TreatmentDayStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'MISSED');

-- CreateEnum
CREATE TYPE "TreatmentDayItemStatus" AS ENUM ('DUE', 'ADMINISTERED', 'SKIPPED', 'HELD');

-- CreateEnum
CREATE TYPE "TreatmentRevisionChangeType" AS ENUM ('MEDICINE_ADDED', 'MEDICINE_REMOVED', 'DOSE_CHANGED', 'DAY_MODIFIED', 'HOLD', 'RESUME', 'STOP');

-- AlterTable: DispenseRequest - add internal order fields
ALTER TABLE "dispense_requests" ADD COLUMN IF NOT EXISTS "requestType" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "requestReason" TEXT,
ADD COLUMN IF NOT EXISTS "tokenId" INTEGER,
ADD COLUMN IF NOT EXISTS "treatmentDayItemId" INTEGER;

-- AlterTable: InjectionToken - add treatment course links
ALTER TABLE "injection_tokens" ADD COLUMN IF NOT EXISTS "treatmentCourseId" INTEGER,
ADD COLUMN IF NOT EXISTS "treatmentDayId" INTEGER,
ADD COLUMN IF NOT EXISTS "selectedVialSessionId" INTEGER;

-- AlterTable: VialSession - add activation source
ALTER TABLE "vial_sessions" ADD COLUMN IF NOT EXISTS "activatedFromDispenseRequestId" INTEGER;

-- AlterTable: TreatmentCourse - add day-wise planning fields
ALTER TABLE "treatment_courses" ADD COLUMN IF NOT EXISTS "branchId" INTEGER,
ADD COLUMN IF NOT EXISTS "prescribedByDoctorId" INTEGER,
ADD COLUMN IF NOT EXISTS "durationDays" INTEGER,
ADD COLUMN IF NOT EXISTS "crossBranchAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "treatmentBranchId" INTEGER,
ADD COLUMN IF NOT EXISTS "holdReason" TEXT;

-- AlterTable: MedicationAdministration - add treatment course links
ALTER TABLE "medication_administrations" ADD COLUMN IF NOT EXISTS "treatmentCourseId" INTEGER,
ADD COLUMN IF NOT EXISTS "treatmentDayItemId" INTEGER;

-- CreateTable: treatment_days
CREATE TABLE "treatment_days" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "status" "TreatmentDayStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable: treatment_day_items
CREATE TABLE "treatment_day_items" (
    "id" SERIAL NOT NULL,
    "treatmentDayId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "medicineName" VARCHAR(255) NOT NULL,
    "dosageMl" DECIMAL(12,4) NOT NULL,
    "route" VARCHAR(64),
    "frequency" VARCHAR(64),
    "expectedNote" TEXT,
    "status" "TreatmentDayItemStatus" NOT NULL DEFAULT 'DUE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_day_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: treatment_revisions
CREATE TABLE "treatment_revisions" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "changedByUserId" INTEGER NOT NULL,
    "changeType" "TreatmentRevisionChangeType" NOT NULL,
    "changeDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_revisions_pkey" PRIMARY KEY ("id")
);

-- Unique constraint treatment_days
CREATE UNIQUE INDEX "treatment_days_courseId_dayNumber_key" ON "treatment_days"("courseId", "dayNumber");

-- Indexes treatment_days
CREATE INDEX "treatment_days_courseId_idx" ON "treatment_days"("courseId");
CREATE INDEX "treatment_days_scheduledDate_idx" ON "treatment_days"("scheduledDate");
CREATE INDEX "treatment_days_status_idx" ON "treatment_days"("status");

-- Indexes treatment_day_items
CREATE INDEX "treatment_day_items_treatmentDayId_idx" ON "treatment_day_items"("treatmentDayId");
CREATE INDEX "treatment_day_items_variantId_idx" ON "treatment_day_items"("variantId");
CREATE INDEX "treatment_day_items_status_idx" ON "treatment_day_items"("status");

-- Indexes treatment_revisions
CREATE INDEX "treatment_revisions_courseId_idx" ON "treatment_revisions"("courseId");
CREATE INDEX "treatment_revisions_changedByUserId_idx" ON "treatment_revisions"("changedByUserId");

-- Indexes DispenseRequest
CREATE INDEX IF NOT EXISTS "dispense_requests_requestType_idx" ON "dispense_requests"("requestType");

-- Indexes InjectionToken
CREATE INDEX IF NOT EXISTS "injection_tokens_treatmentCourseId_idx" ON "injection_tokens"("treatmentCourseId");
CREATE INDEX IF NOT EXISTS "injection_tokens_treatmentDayId_idx" ON "injection_tokens"("treatmentDayId");

-- Indexes VialSession
CREATE INDEX IF NOT EXISTS "vial_sessions_activatedFromDispenseRequestId_idx" ON "vial_sessions"("activatedFromDispenseRequestId");

-- Indexes TreatmentCourse
CREATE INDEX IF NOT EXISTS "treatment_courses_branchId_idx" ON "treatment_courses"("branchId");
CREATE INDEX IF NOT EXISTS "treatment_courses_treatmentBranchId_idx" ON "treatment_courses"("treatmentBranchId");
CREATE INDEX IF NOT EXISTS "treatment_courses_prescribedByDoctorId_idx" ON "treatment_courses"("prescribedByDoctorId");

-- Indexes MedicationAdministration
CREATE INDEX IF NOT EXISTS "medication_administrations_treatmentCourseId_idx" ON "medication_administrations"("treatmentCourseId");
CREATE INDEX IF NOT EXISTS "medication_administrations_treatmentDayItemId_idx" ON "medication_administrations"("treatmentDayItemId");

-- AddForeignKey treatment_days -> treatment_courses
ALTER TABLE "treatment_days" ADD CONSTRAINT "treatment_days_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "treatment_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey treatment_day_items -> treatment_days, product_variants
ALTER TABLE "treatment_day_items" ADD CONSTRAINT "treatment_day_items_treatmentDayId_fkey" FOREIGN KEY ("treatmentDayId") REFERENCES "treatment_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treatment_day_items" ADD CONSTRAINT "treatment_day_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey treatment_revisions -> treatment_courses, users
ALTER TABLE "treatment_revisions" ADD CONSTRAINT "treatment_revisions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "treatment_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treatment_revisions" ADD CONSTRAINT "treatment_revisions_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey dispense_requests -> injection_tokens, treatment_day_items
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "injection_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_treatmentDayItemId_fkey" FOREIGN KEY ("treatmentDayItemId") REFERENCES "treatment_day_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey injection_tokens -> treatment_courses, treatment_days, vial_sessions
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_treatmentCourseId_fkey" FOREIGN KEY ("treatmentCourseId") REFERENCES "treatment_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_treatmentDayId_fkey" FOREIGN KEY ("treatmentDayId") REFERENCES "treatment_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_selectedVialSessionId_fkey" FOREIGN KEY ("selectedVialSessionId") REFERENCES "vial_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey vial_sessions -> dispense_requests
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_activatedFromDispenseRequestId_fkey" FOREIGN KEY ("activatedFromDispenseRequestId") REFERENCES "dispense_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey treatment_courses -> branches, users
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_treatmentBranchId_fkey" FOREIGN KEY ("treatmentBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_prescribedByDoctorId_fkey" FOREIGN KEY ("prescribedByDoctorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey medication_administrations -> treatment_courses, treatment_day_items
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_treatmentCourseId_fkey" FOREIGN KEY ("treatmentCourseId") REFERENCES "treatment_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_treatmentDayItemId_fkey" FOREIGN KEY ("treatmentDayItemId") REFERENCES "treatment_day_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
