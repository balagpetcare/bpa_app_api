-- CreateEnum
CREATE TYPE "ClinicApprovalRequestType" AS ENUM ('PACKAGE_CREATE', 'PACKAGE_UPDATE', 'DOCTOR_INVITE', 'DOCTOR_SCHEDULE', 'DISCOUNT_CHANGE', 'SERVICE_CREATE', 'INVENTORY_PURCHASE');

-- CreateTable
CREATE TABLE "clinic_approval_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestType" "ClinicApprovalRequestType" NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" INTEGER,
    "payload" JSONB NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_approval_requests_branchId_status_idx" ON "clinic_approval_requests"("branchId", "status");

-- CreateIndex
CREATE INDEX "clinic_approval_requests_orgId_status_idx" ON "clinic_approval_requests"("orgId", "status");

-- CreateIndex
CREATE INDEX "clinic_approval_requests_requestType_status_idx" ON "clinic_approval_requests"("requestType", "status");

-- AddForeignKey
ALTER TABLE "clinic_approval_requests" ADD CONSTRAINT "clinic_approval_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_approval_requests" ADD CONSTRAINT "clinic_approval_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_approval_requests" ADD CONSTRAINT "clinic_approval_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_approval_requests" ADD CONSTRAINT "clinic_approval_requests_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
