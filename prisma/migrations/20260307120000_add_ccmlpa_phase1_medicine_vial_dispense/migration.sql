-- CreateEnum
CREATE TYPE "MedicineDestructionRule" AS ENUM ('AFTER_RETENTION', 'IMMEDIATE_ON_EXPIRY', 'MANUAL_APPROVAL_ONLY');

-- CreateEnum
CREATE TYPE "VialStatus" AS ENUM ('SEALED', 'ISSUED', 'OPENED', 'PARTIALLY_USED', 'EXHAUSTED', 'RETURNED', 'QUARANTINED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "VialHolderType" AS ENUM ('PHARMACY', 'ROOM', 'STAFF', 'AUDIT_BIN');

-- CreateEnum
CREATE TYPE "DispenseStatus" AS ENUM ('PENDING', 'APPROVED', 'ISSUED', 'PARTIALLY_ISSUED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispenseUrgencyLevel" AS ENUM ('NORMAL', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "VialSessionStatus" AS ENUM ('ACTIVE', 'PARTIALLY_USED', 'EXHAUSTED', 'EXPIRED', 'RETURNED', 'QUARANTINED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "VialEventType" AS ENUM ('OPENED', 'DOSE_USED', 'RETURNED', 'EXPIRED', 'DESTROYED', 'TRANSFERRED', 'QUARANTINED');

-- CreateTable
CREATE TABLE "medicine_policies" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "orgId" INTEGER NOT NULL,
    "reusableAfterOpen" BOOLEAN NOT NULL DEFAULT false,
    "openVialValidityHours" INTEGER,
    "mixedSolutionValidityHours" INTEGER,
    "returnRequired" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER NOT NULL DEFAULT 7,
    "highRisk" BOOLEAN NOT NULL DEFAULT false,
    "weightCheckRequired" BOOLEAN NOT NULL DEFAULT false,
    "photoRequiredOnReturn" BOOLEAN NOT NULL DEFAULT false,
    "dualApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "destructionRule" "MedicineDestructionRule" NOT NULL DEFAULT 'AFTER_RETENTION',
    "maxDosePerAdministration" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vial_instances" (
    "id" SERIAL NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "batchCode" VARCHAR(64),
    "serialCode" VARCHAR(128),
    "branchId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "orgId" INTEGER,
    "status" "VialStatus" NOT NULL DEFAULT 'SEALED',
    "currentHolderType" "VialHolderType" NOT NULL DEFAULT 'PHARMACY',
    "currentHolderId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vial_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispense_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "patientId" INTEGER,
    "visitId" INTEGER,
    "surgeryCaseId" INTEGER,
    "treatmentCourseId" INTEGER,
    "status" "DispenseStatus" NOT NULL DEFAULT 'PENDING',
    "urgencyLevel" "DispenseUrgencyLevel" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispense_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispense_request_items" (
    "id" SERIAL NOT NULL,
    "dispenseRequestId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "unit" VARCHAR(32),
    "vialInstanceId" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispense_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vial_sessions" (
    "id" SERIAL NOT NULL,
    "vialInstanceId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "branchId" INTEGER NOT NULL,
    "roomId" INTEGER,
    "openedByUserId" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "openPhotoUrl" TEXT,
    "initialQty" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "status" "VialSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vial_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vial_session_events" (
    "id" SERIAL NOT NULL,
    "vialSessionId" INTEGER NOT NULL,
    "eventType" "VialEventType" NOT NULL,
    "quantityDelta" INTEGER,
    "performedByUserId" INTEGER,
    "witnessUserId" INTEGER,
    "photoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vial_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicine_policies_variantId_key" ON "medicine_policies"("variantId");

-- CreateIndex
CREATE INDEX "medicine_policies_orgId_idx" ON "medicine_policies"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "vial_instances_serialCode_key" ON "vial_instances"("serialCode");

-- CreateIndex
CREATE INDEX "vial_instances_branchId_idx" ON "vial_instances"("branchId");

-- CreateIndex
CREATE INDEX "vial_instances_variantId_idx" ON "vial_instances"("variantId");

-- CreateIndex
CREATE INDEX "vial_instances_lotId_idx" ON "vial_instances"("lotId");

-- CreateIndex
CREATE INDEX "vial_instances_locationId_idx" ON "vial_instances"("locationId");

-- CreateIndex
CREATE INDEX "vial_instances_status_idx" ON "vial_instances"("status");

-- CreateIndex
CREATE INDEX "dispense_requests_branchId_idx" ON "dispense_requests"("branchId");

-- CreateIndex
CREATE INDEX "dispense_requests_orgId_idx" ON "dispense_requests"("orgId");

-- CreateIndex
CREATE INDEX "dispense_requests_visitId_idx" ON "dispense_requests"("visitId");

-- CreateIndex
CREATE INDEX "dispense_requests_status_idx" ON "dispense_requests"("status");

-- CreateIndex
CREATE INDEX "dispense_requests_requestedByUserId_idx" ON "dispense_requests"("requestedByUserId");

-- CreateIndex
CREATE INDEX "dispense_request_items_dispenseRequestId_idx" ON "dispense_request_items"("dispenseRequestId");

-- CreateIndex
CREATE INDEX "dispense_request_items_variantId_idx" ON "dispense_request_items"("variantId");

-- CreateIndex
CREATE INDEX "vial_sessions_branchId_idx" ON "vial_sessions"("branchId");

-- CreateIndex
CREATE INDEX "vial_sessions_variantId_idx" ON "vial_sessions"("variantId");

-- CreateIndex
CREATE INDEX "vial_sessions_vialInstanceId_idx" ON "vial_sessions"("vialInstanceId");

-- CreateIndex
CREATE INDEX "vial_sessions_status_idx" ON "vial_sessions"("status");

-- CreateIndex
CREATE INDEX "vial_sessions_validUntil_idx" ON "vial_sessions"("validUntil");

-- CreateIndex
CREATE INDEX "vial_session_events_vialSessionId_idx" ON "vial_session_events"("vialSessionId");

-- CreateIndex
CREATE INDEX "vial_session_events_eventType_idx" ON "vial_session_events"("eventType");

-- AddForeignKey
ALTER TABLE "medicine_policies" ADD CONSTRAINT "medicine_policies_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_policies" ADD CONSTRAINT "medicine_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_instances" ADD CONSTRAINT "vial_instances_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_instances" ADD CONSTRAINT "vial_instances_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_instances" ADD CONSTRAINT "vial_instances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_instances" ADD CONSTRAINT "vial_instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_instances" ADD CONSTRAINT "vial_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_requests" ADD CONSTRAINT "dispense_requests_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_request_items" ADD CONSTRAINT "dispense_request_items_dispenseRequestId_fkey" FOREIGN KEY ("dispenseRequestId") REFERENCES "dispense_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_request_items" ADD CONSTRAINT "dispense_request_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispense_request_items" ADD CONSTRAINT "dispense_request_items_vialInstanceId_fkey" FOREIGN KEY ("vialInstanceId") REFERENCES "vial_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_vialInstanceId_fkey" FOREIGN KEY ("vialInstanceId") REFERENCES "vial_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "branch_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_sessions" ADD CONSTRAINT "vial_sessions_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_session_events" ADD CONSTRAINT "vial_session_events_vialSessionId_fkey" FOREIGN KEY ("vialSessionId") REFERENCES "vial_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vial_session_events" ADD CONSTRAINT "vial_session_events_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
