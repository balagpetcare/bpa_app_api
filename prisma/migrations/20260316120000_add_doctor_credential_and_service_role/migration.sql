-- CreateEnum
CREATE TYPE "DoctorCredentialStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ClinicApprovalRequestType" ADD VALUE 'DOCTOR_CREDENTIAL';

-- CreateTable
CREATE TABLE "doctor_credentials" (
    "id" SERIAL NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "licenseNumber" VARCHAR(128),
    "authority" VARCHAR(128),
    "expiryDate" DATE,
    "documentUrl" TEXT,
    "status" "DoctorCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_credentials_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "doctor_service_mappings" ADD COLUMN "role" VARCHAR(32);

-- CreateIndex
CREATE INDEX "doctor_credentials_branchId_doctorId_idx" ON "doctor_credentials"("branchId", "doctorId");

-- CreateIndex
CREATE INDEX "doctor_credentials_branchId_status_idx" ON "doctor_credentials"("branchId", "status");

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
