-- Enterprise Surgery Module: SurgeryCase, SurgeryCaseStaff, SurgeryCaseStatusLog, SurgeryCaseChecklist; extend ClinicInvoice, DoctorSettlementLedger, SurgeryPackageTemplate

-- CreateEnum
CREATE TYPE "SurgeryCaseStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PRE_OP', 'READY_FOR_OT', 'IN_PROGRESS', 'POST_OP', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SurgeryCasePriority" AS ENUM ('NORMAL', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "SurgeryStaffRole" AS ENUM ('PRIMARY_SURGEON', 'ASSISTANT_SURGEON', 'ANESTHETIST', 'OT_NURSE', 'TECHNICIAN');

-- CreateTable: surgery_cases
CREATE TABLE "surgery_cases" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalCaseId" INTEGER,
    "appointmentId" INTEGER,
    "visitId" INTEGER,
    "patientId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "surgeryPackageId" INTEGER,
    "roomId" INTEGER,
    "primaryDoctorId" INTEGER NOT NULL,
    "caseNumber" VARCHAR(32) NOT NULL,
    "surgeryType" VARCHAR(64),
    "priority" "SurgeryCasePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SurgeryCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "preopNotes" TEXT,
    "operativeNotes" TEXT,
    "postopNotes" TEXT,
    "complicationNotes" TEXT,
    "dischargeNotes" TEXT,
    "followUpDate" DATE,
    "pricingSnapshotJson" JSONB,
    "feeRuleSnapshotJson" JSONB,
    "estimatedAmount" DECIMAL(12,2),
    "advancePaid" DECIMAL(12,2),
    "createdByUserId" INTEGER NOT NULL,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgery_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surgery_cases_caseNumber_key" ON "surgery_cases"("caseNumber");
CREATE UNIQUE INDEX "surgery_cases_clinicalCaseId_key" ON "surgery_cases"("clinicalCaseId");
CREATE UNIQUE INDEX "surgery_cases_appointmentId_key" ON "surgery_cases"("appointmentId");
CREATE UNIQUE INDEX "surgery_cases_visitId_key" ON "surgery_cases"("visitId");
CREATE INDEX "surgery_cases_branchId_status_idx" ON "surgery_cases"("branchId", "status");
CREATE INDEX "surgery_cases_branchId_scheduledStartAt_idx" ON "surgery_cases"("branchId", "scheduledStartAt");
CREATE INDEX "surgery_cases_primaryDoctorId_idx" ON "surgery_cases"("primaryDoctorId");
CREATE INDEX "surgery_cases_patientId_idx" ON "surgery_cases"("patientId");
CREATE INDEX "surgery_cases_petId_idx" ON "surgery_cases"("petId");

ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "branch_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_primaryDoctorId_fkey" FOREIGN KEY ("primaryDoctorId") REFERENCES "branch_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "surgery_cases" ADD CONSTRAINT "surgery_cases_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: surgery_case_staff
CREATE TABLE "surgery_case_staff" (
    "id" SERIAL NOT NULL,
    "surgeryCaseId" INTEGER NOT NULL,
    "branchMemberId" INTEGER NOT NULL,
    "role" "SurgeryStaffRole" NOT NULL,
    "feeType" VARCHAR(16),
    "feeValue" DECIMAL(12,2),
    "payoutAmount" DECIMAL(12,2),
    "attendanceStatus" VARCHAR(16),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgery_case_staff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surgery_case_staff_surgeryCaseId_branchMemberId_key" ON "surgery_case_staff"("surgeryCaseId", "branchMemberId");
CREATE INDEX "surgery_case_staff_surgeryCaseId_idx" ON "surgery_case_staff"("surgeryCaseId");

ALTER TABLE "surgery_case_staff" ADD CONSTRAINT "surgery_case_staff_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_case_staff" ADD CONSTRAINT "surgery_case_staff_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: surgery_case_status_logs
CREATE TABLE "surgery_case_status_logs" (
    "id" SERIAL NOT NULL,
    "surgeryCaseId" INTEGER NOT NULL,
    "fromStatus" "SurgeryCaseStatus",
    "toStatus" "SurgeryCaseStatus" NOT NULL,
    "changedByUserId" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_case_status_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surgery_case_status_logs_surgeryCaseId_idx" ON "surgery_case_status_logs"("surgeryCaseId");

ALTER TABLE "surgery_case_status_logs" ADD CONSTRAINT "surgery_case_status_logs_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_case_status_logs" ADD CONSTRAINT "surgery_case_status_logs_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: surgery_case_checklists
CREATE TABLE "surgery_case_checklists" (
    "id" SERIAL NOT NULL,
    "surgeryCaseId" INTEGER NOT NULL,
    "phase" VARCHAR(16) NOT NULL,
    "itemLabel" VARCHAR(256) NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedByUserId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgery_case_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surgery_case_checklists_surgeryCaseId_phase_idx" ON "surgery_case_checklists"("surgeryCaseId", "phase");

ALTER TABLE "surgery_case_checklists" ADD CONSTRAINT "surgery_case_checklists_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_case_checklists" ADD CONSTRAINT "surgery_case_checklists_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: clinic_invoices
ALTER TABLE "clinic_invoices" ADD COLUMN "surgeryCaseId" INTEGER,
ADD COLUMN "anesthesiaCharge" DECIMAL(12,2),
ADD COLUMN "otCharge" DECIMAL(12,2),
ADD COLUMN "equipmentCharge" DECIMAL(12,2),
ADD COLUMN "labCharge" DECIMAL(12,2),
ADD COLUMN "billingStatus" VARCHAR(16);

CREATE UNIQUE INDEX "clinic_invoices_surgeryCaseId_key" ON "clinic_invoices"("surgeryCaseId");
CREATE INDEX "clinic_invoices_surgeryCaseId_idx" ON "clinic_invoices"("surgeryCaseId");

ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: doctor_settlement_ledger
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN "surgeryCaseId" INTEGER,
ADD COLUMN "staffRole" VARCHAR(32);

CREATE INDEX "doctor_settlement_ledger_surgeryCaseId_idx" ON "doctor_settlement_ledger"("surgeryCaseId");

ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: surgery_package_templates
ALTER TABLE "surgery_package_templates" ADD COLUMN "preopChecklistJson" JSONB,
ADD COLUMN "defaultStaffRolesJson" JSONB,
ADD COLUMN "postopInstructionsJson" JSONB;

-- Add FK for dispense_requests.surgeryCaseId (column may already exist from prior migration)
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add FK for medication_administrations.surgeryCaseId (column may already exist from prior migration)
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
