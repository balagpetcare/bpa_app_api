-- CreateEnum
CREATE TYPE "DoctorRequestType" AS ENUM ('VISIT_FEE_CHANGE', 'SCHEDULE_CHANGE', 'APPOINTMENT_CANCEL', 'LEAVE_CLINIC', 'JOIN_CLINIC');

-- CreateEnum
CREATE TYPE "DoctorRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "doctor_requests" (
    "id" SERIAL NOT NULL,
    "doctorUserId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "type" "DoctorRequestType" NOT NULL,
    "payload" JSONB,
    "status" "DoctorRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_requests_doctorUserId_idx" ON "doctor_requests"("doctorUserId");

-- CreateIndex
CREATE INDEX "doctor_requests_branchId_idx" ON "doctor_requests"("branchId");

-- CreateIndex
CREATE INDEX "doctor_requests_status_idx" ON "doctor_requests"("status");

-- AddForeignKey
ALTER TABLE "doctor_requests" ADD CONSTRAINT "doctor_requests_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_requests" ADD CONSTRAINT "doctor_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_requests" ADD CONSTRAINT "doctor_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
