-- Drift Reconciliation Baseline Migration
-- Generated: 2026-03-28T21:34:07.171Z
-- Purpose: Aligns migration history with live database state.
-- This migration was marked as "already applied" via prisma migrate resolve
-- because the live database already contains all these changes.
-- DO NOT run this SQL against the live database — it is already applied.

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SCHEDULED', 'EXPIRED', 'ARCHIVED', 'INACTIVE');

-- AlterEnum
BEGIN;
CREATE TYPE "AuthBatchStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'GENERATED', 'CODES_ALLOCATED', 'PRINTED', 'VOIDED', 'ARCHIVED');
ALTER TABLE "public"."auth_batches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "auth_batches" ALTER COLUMN "status" TYPE "AuthBatchStatus_new" USING ("status"::text::"AuthBatchStatus_new");
ALTER TYPE "AuthBatchStatus" RENAME TO "AuthBatchStatus_old";
ALTER TYPE "AuthBatchStatus_new" RENAME TO "AuthBatchStatus";
DROP TYPE "public"."AuthBatchStatus_old";
ALTER TABLE "auth_batches" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AuthProductStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
ALTER TABLE "public"."auth_products" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "auth_products" ALTER COLUMN "status" TYPE "AuthProductStatus_new" USING ("status"::text::"AuthProductStatus_new");
ALTER TYPE "AuthProductStatus" RENAME TO "AuthProductStatus_old";
ALTER TYPE "AuthProductStatus_new" RENAME TO "AuthProductStatus";
DROP TYPE "public"."AuthProductStatus_old";
ALTER TABLE "auth_products" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DiscountAbsorptionMode" ADD VALUE 'DOCTOR_ONLY';
ALTER TYPE "DiscountAbsorptionMode" ADD VALUE 'EQUAL_SPLIT';
ALTER TYPE "DiscountAbsorptionMode" ADD VALUE 'MANUAL_SPLIT';
ALTER TYPE "DiscountAbsorptionMode" ADD VALUE 'CLINIC_ONLY';

-- AlterEnum
ALTER TYPE "DoctorContractType" ADD VALUE 'HYBRID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'DOCTOR_REGISTRATION';
ALTER TYPE "DocumentType" ADD VALUE 'DOCTOR_DEGREE';
ALTER TYPE "DocumentType" ADD VALUE 'DOCTOR_PHOTO';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('VERIFICATION_CASE_SUBMITTED', 'VERIFICATION_CASE_APPROVED', 'VERIFICATION_CASE_REJECTED', 'VERIFICATION_DOCUMENT_APPROVED', 'VERIFICATION_DOCUMENT_REJECTED', 'OWNER_KYC_SUBMITTED', 'SYSTEM', 'STAFF_INVITE', 'STAFF_BRANCH_ACCESS_REQUEST', 'STAFF_BRANCH_ACCESS_APPROVED', 'STAFF_BRANCH_ACCESS_REVOKED', 'STAFF_BRANCH_ACCESS_EXPIRED', 'INVENTORY_STOCK_REQUEST', 'INVENTORY_LOW_STOCK', 'INVENTORY_TRANSFER', 'FINANCE_PAYMENT', 'FINANCE_PAYOUT', 'CLINIC_APPOINTMENT', 'CLINIC_PRESCRIPTION', 'BATCH_SUSPICIOUS_ACTIVITY', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'ENFORCEMENT_CODE_BLOCKED', 'ENFORCEMENT_BATCH_QUARANTINED', 'ENFORCEMENT_PRODUCT_DEACTIVATED', 'ENFORCEMENT_ORG_SUSPENDED', 'ENFORCEMENT_ACTION_REVERTED', 'TICKET_CREATED', 'TICKET_REPLIED', 'TICKET_STATUS_CHANGED', 'TICKET_ASSIGNED', 'TICKET_SLA_BREACH');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "auth_products" DROP CONSTRAINT "auth_products_reviewedByAdminId_fkey";

-- DropForeignKey
ALTER TABLE "producer_org_staff_factories" DROP CONSTRAINT "producer_org_staff_factories_producerFactoryId_fkey";

-- DropForeignKey
ALTER TABLE "producer_org_staff_factories" DROP CONSTRAINT "producer_org_staff_factories_producerOrgStaffId_fkey";

-- DropForeignKey
ALTER TABLE "producer_permission_templates" DROP CONSTRAINT "producer_permission_templates_producerOrgId_fkey";

-- DropForeignKey
ALTER TABLE "producer_permission_templates" DROP CONSTRAINT "producer_permission_templates_roleId_fkey";

-- DropIndex
DROP INDEX "appointments_branchId_scheduledStartAt_idx";

-- DropIndex
DROP INDEX "appointments_branchId_status_scheduledStartAt_idx";

-- DropIndex
DROP INDEX "appointments_doctorId_scheduledStartAt_idx";

-- DropIndex
DROP INDEX "auth_batches_ctlNo_key";

-- DropIndex
DROP INDEX "auth_products_ctlNo_key";

-- DropIndex
DROP INDEX "dispense_requests_receivedByUserId_idx";

-- DropIndex
DROP INDEX "medicine_approval_requests_approvedByUserId_idx";

-- DropIndex
DROP INDEX "notifications_userId_panel_idx";

-- DropIndex
DROP INDEX "producer_audit_logs_factoryId_idx";

-- DropIndex
DROP INDEX "stock_transfers_stockRequestId_key";

-- AlterTable
ALTER TABLE "auth_batches" DROP COLUMN "ctlNo",
DROP COLUMN "isFrozen";

-- AlterTable
ALTER TABLE "auth_products" DROP COLUMN "ctlNo",
DROP COLUMN "editLocked";

-- AlterTable
ALTER TABLE "delivery_assignments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "governance_incidents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "panel";

-- AlterTable
ALTER TABLE "producer_approvals" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "producer_audit_logs" DROP COLUMN "actorIp",
DROP COLUMN "actorRoleKey",
DROP COLUMN "factoryId",
DROP COLUMN "metadataJson";

-- AlterTable
ALTER TABLE "producer_email_recipients" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "producer_factories" DROP COLUMN "isFrozen";

-- AlterTable
ALTER TABLE "producer_org_staff" DROP COLUMN "lastSeenAt",
DROP COLUMN "lastSeenIp",
DROP COLUMN "loginDisabled",
DROP COLUMN "loginDisabledAt",
DROP COLUMN "loginDisabledByUserId",
DROP COLUMN "removedAt",
DROP COLUMN "removedByUserId";

-- AlterTable
ALTER TABLE "producer_staff_invites" DROP COLUMN "deletedAt",
DROP COLUMN "deletedByUserId",
DROP COLUMN "factoryIds",
ALTER COLUMN "email" SET DATA TYPE TEXT,
ALTER COLUMN "phone" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isMedicine" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "medicineListingId" INTEGER;

-- AlterTable
ALTER TABLE "service_deliveries" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_dispatches" ALTER COLUMN "stockRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock_request_items" ADD COLUMN     "cancelReason" VARCHAR(500),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" INTEGER,
ADD COLUMN     "cancelledQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "warehouses" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "producer_org_staff_factories";

-- DropTable
DROP TABLE "producer_permission_templates";

-- CreateTable
CREATE TABLE "owner_discount_cards" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "cardNumber" VARCHAR(32) NOT NULL,
    "discountPercent" DOUBLE PRECISION NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "issuedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_discount_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_doctor_approvals" (
    "id" SERIAL NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "requestedByUserId" INTEGER NOT NULL,
    "approvalStatus" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "customFeeAmount" DECIMAL(12,2),
    "billingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_doctor_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_discount_cards_cardNumber_key" ON "owner_discount_cards"("cardNumber");

-- CreateIndex
CREATE INDEX "owner_discount_cards_userId_idx" ON "owner_discount_cards"("userId");

-- CreateIndex
CREATE INDEX "owner_discount_cards_orgId_idx" ON "owner_discount_cards"("orgId");

-- CreateIndex
CREATE INDEX "owner_discount_cards_branchId_idx" ON "owner_discount_cards"("branchId");

-- CreateIndex
CREATE INDEX "owner_discount_cards_cardNumber_idx" ON "owner_discount_cards"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_doctor_approvals_appointmentId_key" ON "emergency_doctor_approvals"("appointmentId");

-- CreateIndex
CREATE INDEX "emergency_doctor_approvals_appointmentId_idx" ON "emergency_doctor_approvals"("appointmentId");

-- CreateIndex
CREATE INDEX "emergency_doctor_approvals_approvalStatus_idx" ON "emergency_doctor_approvals"("approvalStatus");

-- CreateIndex
CREATE INDEX "medication_administrations_surgeryCaseId_idx" ON "medication_administrations"("surgeryCaseId");

-- CreateIndex (replace COALESCE-based version with standard Prisma-compatible version)
DROP INDEX IF EXISTS "owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key";
CREATE UNIQUE INDEX "owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key" ON "owner_delegations"("ownerUserId", "delegatedUserId", "scopeKey", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "products_medicineListingId_key" ON "products"("medicineListingId");

-- CreateIndex
CREATE INDEX "products_isMedicine_idx" ON "products"("isMedicine");

-- CreateIndex
CREATE INDEX "stock_request_items_cancelledByUserId_idx" ON "stock_request_items"("cancelledByUserId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_medicineListingId_fkey" FOREIGN KEY ("medicineListingId") REFERENCES "country_medicine_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_doctor_approvals" ADD CONSTRAINT "emergency_doctor_approvals_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_doctor_approvals" ADD CONSTRAINT "emergency_doctor_approvals_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_doctor_approvals" ADD CONSTRAINT "emergency_doctor_approvals_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex (idempotent — may already have been renamed by earlier migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'doctor_settlement_ledger_clinicStaffProfileId_settlementStatus_') THEN
    ALTER INDEX "doctor_settlement_ledger_clinicStaffProfileId_settlementStatus_" RENAME TO "doctor_settlement_ledger_clinicStaffProfileId_settlementSta_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'medicine_presentations_genericId_dosageFormId_strengthNormalize') THEN
    ALTER INDEX "medicine_presentations_genericId_dosageFormId_strengthNormalize" RENAME TO "medicine_presentations_genericId_dosageFormId_strengthNorma_key";
  END IF;
END $$;

