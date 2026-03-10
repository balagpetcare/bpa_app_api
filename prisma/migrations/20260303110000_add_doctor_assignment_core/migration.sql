-- Extend ClinicStaffProfile with contract/terms/policy/capacity fields
ALTER TABLE "clinic_staff_profiles"
ADD COLUMN "roleInClinic" VARCHAR(32),
ADD COLUMN "visitTypes" JSONB,
ADD COLUMN "followUpFee" DECIMAL(12,2),
ADD COLUMN "emergencyFee" DECIMAL(12,2),
ADD COLUMN "commissionPolicy" JSONB,
ADD COLUMN "scheduleEditPolicy" VARCHAR(32) NOT NULL DEFAULT 'BOTH',
ADD COLUMN "contractStatus" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "contractStartDate" TIMESTAMP(3),
ADD COLUMN "contractEndDate" TIMESTAMP(3),
ADD COLUMN "contractNotes" TEXT,
ADD COLUMN "maxPatientsPerDay" INTEGER,
ADD COLUMN "allowEmergencyOverbook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "permissionOverrides" JSONB,
ADD COLUMN "travelBufferMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "doctor_service_fees" (
    "id" SERIAL NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "durationMin" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_service_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule_proposals" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchMemberId" INTEGER NOT NULL,
    "proposalPayload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_schedule_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_audit_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "field" VARCHAR(64),
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedByUserId" INTEGER NOT NULL,
    "changedByRole" VARCHAR(32),
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_settlement_ledger" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "visitId" INTEGER,
    "orderId" INTEGER,
    "type" VARCHAR(32) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "clinicShare" DECIMAL(12,2) NOT NULL,
    "doctorShare" DECIMAL(12,2) NOT NULL,
    "settlementStatus" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "settledByUserId" INTEGER,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_settlement_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctor_service_fees_clinicStaffProfileId_serviceId_key" ON "doctor_service_fees"("clinicStaffProfileId", "serviceId");

-- CreateIndex
CREATE INDEX "doctor_service_fees_clinicStaffProfileId_idx" ON "doctor_service_fees"("clinicStaffProfileId");

-- CreateIndex
CREATE INDEX "doctor_service_fees_serviceId_idx" ON "doctor_service_fees"("serviceId");

-- CreateIndex
CREATE INDEX "doctor_schedule_proposals_branchId_status_idx" ON "doctor_schedule_proposals"("branchId", "status");

-- CreateIndex
CREATE INDEX "doctor_schedule_proposals_branchMemberId_idx" ON "doctor_schedule_proposals"("branchMemberId");

-- CreateIndex
CREATE INDEX "doctor_audit_logs_clinicStaffProfileId_idx" ON "doctor_audit_logs"("clinicStaffProfileId");

-- CreateIndex
CREATE INDEX "doctor_audit_logs_branchId_action_idx" ON "doctor_audit_logs"("branchId", "action");

-- CreateIndex
CREATE INDEX "doctor_settlement_ledger_clinicStaffProfileId_settlementStatus_idx" ON "doctor_settlement_ledger"("clinicStaffProfileId", "settlementStatus");

-- CreateIndex
CREATE INDEX "doctor_settlement_ledger_branchId_settlementStatus_idx" ON "doctor_settlement_ledger"("branchId", "settlementStatus");

-- AddForeignKey
ALTER TABLE "doctor_service_fees" ADD CONSTRAINT "doctor_service_fees_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_service_fees" ADD CONSTRAINT "doctor_service_fees_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_proposals" ADD CONSTRAINT "doctor_schedule_proposals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_proposals" ADD CONSTRAINT "doctor_schedule_proposals_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_proposals" ADD CONSTRAINT "doctor_schedule_proposals_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_audit_logs" ADD CONSTRAINT "doctor_audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_audit_logs" ADD CONSTRAINT "doctor_audit_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_audit_logs" ADD CONSTRAINT "doctor_audit_logs_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
