-- CreateEnum
CREATE TYPE "ServiceDepartment" AS ENUM ('DOCTOR_DESK', 'LAB', 'PHARMACY', 'PROCEDURE_ROOM', 'GROOMING_UNIT');

-- CreateEnum
CREATE TYPE "PaymentGateRule" AS ENUM ('PAY_BEFORE_SERVICE', 'PAY_AFTER_SERVICE', 'PARTIAL_DEPOSIT', 'NO_GATE');

-- CreateEnum
CREATE TYPE "ServiceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum: add new values to ServiceCategory
ALTER TYPE "ServiceCategory" ADD VALUE 'TEST';
ALTER TYPE "ServiceCategory" ADD VALUE 'PROCEDURE';
ALTER TYPE "ServiceCategory" ADD VALUE 'PHARMACY';

-- AlterTable: clinic_staff_profiles add onboardingStatus
ALTER TABLE "clinic_staff_profiles" ADD COLUMN "onboardingStatus" VARCHAR(16) NOT NULL DEFAULT 'PENDING';

-- AlterTable: services add new columns
ALTER TABLE "services" ADD COLUMN "department" "ServiceDepartment" NOT NULL DEFAULT 'DOCTOR_DESK';
ALTER TABLE "services" ADD COLUMN "paymentGateRule" "PaymentGateRule" NOT NULL DEFAULT 'PAY_BEFORE_SERVICE';
ALTER TABLE "services" ADD COLUMN "serviceCode" VARCHAR(32);
ALTER TABLE "services" ADD COLUMN "prerequisiteRule" JSONB;
ALTER TABLE "services" ADD COLUMN "allowDiscount" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "services" ADD COLUMN "maxDiscountPct" DECIMAL(5,2);
ALTER TABLE "services" ADD COLUMN "discountNeedsApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN "taxRuleJson" JSONB;
ALTER TABLE "services" ADD COLUMN "applicableSpecies" JSONB;
ALTER TABLE "services" ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN "proposedByUserId" INTEGER;
ALTER TABLE "services" ADD COLUMN "approvalStatus" "ServiceApprovalStatus";

CREATE UNIQUE INDEX "services_serviceCode_key" ON "services"("serviceCode");

-- AlterTable: doctor_service_fees add species, change unique constraint
ALTER TABLE "doctor_service_fees" ADD COLUMN "species" VARCHAR(32);

DROP INDEX IF EXISTS "doctor_service_fees_clinicStaffProfileId_serviceId_key";
CREATE UNIQUE INDEX "doctor_service_fees_clinicStaffProfileId_serviceId_species_key" ON "doctor_service_fees"("clinicStaffProfileId", "serviceId", "species");

-- CreateTable: service_pricing_variants
CREATE TABLE "service_pricing_variants" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "species" VARCHAR(32) NOT NULL,
    "sex" VARCHAR(16),
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_pricing_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_pricing_variants_serviceId_species_sex_key" ON "service_pricing_variants"("serviceId", "species", "sex");
CREATE INDEX "service_pricing_variants_serviceId_idx" ON "service_pricing_variants"("serviceId");

ALTER TABLE "service_pricing_variants" ADD CONSTRAINT "service_pricing_variants_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: service_proposals
CREATE TABLE "service_proposals" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "department" "ServiceDepartment" NOT NULL,
    "suggestedPrice" DECIMAL(12,2),
    "reason" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "proposedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdServiceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_proposals_branchId_status_idx" ON "service_proposals"("branchId", "status");

ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: service_deliveries add payment gate fields
ALTER TABLE "service_deliveries" ADD COLUMN "orderId" INTEGER;
ALTER TABLE "service_deliveries" ADD COLUMN "paymentVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_deliveries" ADD COLUMN "paymentVerifiedAt" TIMESTAMP(3);
ALTER TABLE "service_deliveries" ADD COLUMN "verifiedByUserId" INTEGER;
ALTER TABLE "service_deliveries" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "service_deliveries_orderId_idx" ON "service_deliveries"("orderId");

ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: order_items add serviceId, make productId nullable
ALTER TABLE "order_items" ADD COLUMN "serviceId" INTEGER;
ALTER TABLE "order_items" ALTER COLUMN "productId" DROP NOT NULL;

CREATE INDEX "order_items_serviceId_idx" ON "order_items"("serviceId");

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
