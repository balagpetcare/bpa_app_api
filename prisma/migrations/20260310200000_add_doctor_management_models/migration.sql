-- AlterEnum: add new values to ClinicApprovalRequestType
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_FEE_CHANGE';
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_ACTIVATION';
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_DEACTIVATION';
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_SERVICE_PRIVILEGE';
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_PACKAGE_PRIVILEGE';
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_LEAVE';

-- CreateEnum
CREATE TYPE "DoctorLeaveType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'EMERGENCY', 'HOLIDAY_EXEMPTION');

CREATE TYPE "DoctorLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "DoctorPackageRole" AS ENUM ('PRIMARY', 'ASSISTANT', 'CONSULTANT', 'SURGEON', 'BACKUP');

CREATE TYPE "DoctorServiceMappingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING_APPROVAL');

-- CreateTable: doctor_leave_requests
CREATE TABLE "doctor_leave_requests" (
    "id" SERIAL NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "leaveType" "DoctorLeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "status" "DoctorLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "autoReassign" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: doctor_service_mappings
CREATE TABLE "doctor_service_mappings" (
    "id" SERIAL NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "isAllowed" BOOLEAN NOT NULL DEFAULT true,
    "customDuration" INTEGER,
    "bookingType" VARCHAR(32),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "DoctorServiceMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_service_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: doctor_package_mappings
CREATE TABLE "doctor_package_mappings" (
    "id" SERIAL NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "surgeryPackageId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "roleInPackage" "DoctorPackageRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "feeShareType" VARCHAR(32),
    "activeFrom" DATE,
    "activeTo" DATE,
    "bookingEligible" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_package_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_leave_requests_branchId_status_idx" ON "doctor_leave_requests"("branchId", "status");
CREATE INDEX "doctor_leave_requests_clinicStaffProfileId_idx" ON "doctor_leave_requests"("clinicStaffProfileId");
CREATE INDEX "doctor_leave_requests_startDate_endDate_idx" ON "doctor_leave_requests"("startDate", "endDate");

CREATE UNIQUE INDEX "doctor_service_mappings_clinicStaffProfileId_serviceId_key" ON "doctor_service_mappings"("clinicStaffProfileId", "serviceId");
CREATE INDEX "doctor_service_mappings_branchId_idx" ON "doctor_service_mappings"("branchId");
CREATE INDEX "doctor_service_mappings_serviceId_idx" ON "doctor_service_mappings"("serviceId");

CREATE INDEX "doctor_package_mappings_branchId_idx" ON "doctor_package_mappings"("branchId");
CREATE INDEX "doctor_package_mappings_surgeryPackageId_idx" ON "doctor_package_mappings"("surgeryPackageId");
CREATE INDEX "doctor_package_mappings_clinicStaffProfileId_idx" ON "doctor_package_mappings"("clinicStaffProfileId");

-- AddForeignKey: doctor_leave_requests
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_leave_requests" ADD CONSTRAINT "doctor_leave_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: doctor_service_mappings
ALTER TABLE "doctor_service_mappings" ADD CONSTRAINT "doctor_service_mappings_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_service_mappings" ADD CONSTRAINT "doctor_service_mappings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_service_mappings" ADD CONSTRAINT "doctor_service_mappings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: doctor_package_mappings
ALTER TABLE "doctor_package_mappings" ADD CONSTRAINT "doctor_package_mappings_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_package_mappings" ADD CONSTRAINT "doctor_package_mappings_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_package_mappings" ADD CONSTRAINT "doctor_package_mappings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
