-- AlterEnum: extend PackageItemType
ALTER TYPE "PackageItemType" ADD VALUE 'INTERNAL_USE';
ALTER TYPE "PackageItemType" ADD VALUE 'SEPARATE_BILL';
ALTER TYPE "PackageItemType" ADD VALUE 'DOCTOR_COMPONENT';
ALTER TYPE "PackageItemType" ADD VALUE 'SERVICE_COMPONENT';

-- CreateEnum: ClinicalItemDomain
CREATE TYPE "ClinicalItemDomain" AS ENUM ('MEDICINE', 'SURGICAL_CONSUMABLE', 'DRESSING_SUPPLY', 'CLINIC_SUPPLY', 'INSTRUMENT', 'IMPLANT', 'SERVICE_SUPPORT', 'PACKAGE_ONLY');

-- CreateEnum: ConsumableType
CREATE TYPE "ConsumableType" AS ENUM ('SUTURE', 'BLADE', 'GAUZE', 'SYRINGE', 'GLOVE', 'IV_SET', 'DRESSING', 'OT_DISPOSABLE', 'OTHER');

-- CreateEnum: InstrumentType
CREATE TYPE "InstrumentType" AS ENUM ('SCISSORS', 'FORCEPS', 'CLAMP', 'HOLDER', 'RETRACTOR', 'SCALPEL', 'OTHER');

-- CreateEnum: ItemAuditAction
CREATE TYPE "ItemAuditAction" AS ENUM ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'BRANCH_MAP', 'PACKAGE_MAP', 'PRICE_CHANGE', 'STOCK_CHANGE', 'APPROVE', 'CONSUME', 'WASTAGE', 'RETURN', 'STERILIZE');

-- CreateEnum: ItemApprovalStatus
CREATE TYPE "ItemApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable: clinical_item_categories
CREATE TABLE "clinical_item_categories" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "parentId" INTEGER,
    "domainType" "ClinicalItemDomain",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_item_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_item_categories_orgId_idx" ON "clinical_item_categories"("orgId");
CREATE INDEX "clinical_item_categories_parentId_idx" ON "clinical_item_categories"("parentId");

-- CreateTable: clinical_items
CREATE TABLE "clinical_items" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "itemCode" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "slug" VARCHAR(256) NOT NULL,
    "domainType" "ClinicalItemDomain" NOT NULL,
    "categoryId" INTEGER,
    "baseUnit" VARCHAR(32),
    "description" TEXT,
    "brandName" VARCHAR(128),
    "manufacturerName" VARCHAR(128),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isClinicUse" BOOLEAN NOT NULL DEFAULT true,
    "isSellable" BOOLEAN NOT NULL DEFAULT false,
    "isPackageEligible" BOOLEAN NOT NULL DEFAULT true,
    "isInventoryTracked" BOOLEAN NOT NULL DEFAULT true,
    "requiresBatch" BOOLEAN NOT NULL DEFAULT false,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isReusable" BOOLEAN NOT NULL DEFAULT false,
    "isHighRisk" BOOLEAN NOT NULL DEFAULT false,
    "defaultCost" DECIMAL(12,2),
    "defaultSalePrice" DECIMAL(12,2),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_items_orgId_itemCode_key" ON "clinical_items"("orgId", "itemCode");
CREATE UNIQUE INDEX "clinical_items_orgId_slug_key" ON "clinical_items"("orgId", "slug");
CREATE INDEX "clinical_items_orgId_idx" ON "clinical_items"("orgId");
CREATE INDEX "clinical_items_categoryId_idx" ON "clinical_items"("categoryId");
CREATE INDEX "clinical_items_domainType_idx" ON "clinical_items"("domainType");

-- CreateTable: clinical_item_variants
CREATE TABLE "clinical_item_variants" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "variantName" VARCHAR(128) NOT NULL,
    "sku" VARCHAR(64),
    "barcode" VARCHAR(64),
    "unitLabel" VARCHAR(32),
    "packSize" VARCHAR(64),
    "strengthOrSpec" VARCHAR(128),
    "defaultCost" DECIMAL(12,2),
    "defaultSalePrice" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_item_variants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_item_variants_itemId_idx" ON "clinical_item_variants"("itemId");
CREATE UNIQUE INDEX "clinical_item_variants_itemId_sku_key" ON "clinical_item_variants"("itemId", "sku");

-- CreateTable: medicine_item_profiles
CREATE TABLE "medicine_item_profiles" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "genericName" VARCHAR(256),
    "dosageForm" VARCHAR(64),
    "strength" VARCHAR(128),
    "route" VARCHAR(64),
    "pharmacologyClass" VARCHAR(128),
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "controlledSubstance" BOOLEAN NOT NULL DEFAULT false,
    "dispenseUnit" VARCHAR(32),
    "batchMandatory" BOOLEAN NOT NULL DEFAULT true,
    "expiryMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_item_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medicine_item_profiles_itemId_key" ON "medicine_item_profiles"("itemId");

-- CreateTable: consumable_item_profiles
CREATE TABLE "consumable_item_profiles" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "consumableType" "ConsumableType" NOT NULL DEFAULT 'OTHER',
    "sterileRequired" BOOLEAN NOT NULL DEFAULT false,
    "singleUseOnly" BOOLEAN NOT NULL DEFAULT true,
    "procedureLinked" BOOLEAN NOT NULL DEFAULT false,
    "wastageTrackRequired" BOOLEAN NOT NULL DEFAULT false,
    "issueUnit" VARCHAR(32),
    "usageNoteTemplate" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumable_item_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consumable_item_profiles_itemId_key" ON "consumable_item_profiles"("itemId");

-- CreateTable: instrument_item_profiles
CREATE TABLE "instrument_item_profiles" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "instrumentType" "InstrumentType" NOT NULL DEFAULT 'OTHER',
    "sterilizationRequired" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceRequired" BOOLEAN NOT NULL DEFAULT false,
    "assetTrackingRequired" BOOLEAN NOT NULL DEFAULT false,
    "issueReturnRequired" BOOLEAN NOT NULL DEFAULT true,
    "serviceCycleDays" INTEGER,
    "serialTracking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_item_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instrument_item_profiles_itemId_key" ON "instrument_item_profiles"("itemId");

-- CreateTable: branch_item_stocks
CREATE TABLE "branch_item_stocks" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "currentQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "availableQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(12,4),
    "maxLevel" DECIMAL(12,4),
    "avgCost" DECIMAL(12,2),
    "lastPurchaseCost" DECIMAL(12,2),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_item_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_item_stocks_branchId_itemId_variantId_key" ON "branch_item_stocks"("branchId", "itemId", "variantId");
CREATE INDEX "branch_item_stocks_branchId_idx" ON "branch_item_stocks"("branchId");
CREATE INDEX "branch_item_stocks_itemId_idx" ON "branch_item_stocks"("itemId");

-- CreateTable: branch_item_batches
CREATE TABLE "branch_item_batches" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "batchNo" VARCHAR(64) NOT NULL,
    "expiryDate" DATE,
    "receivedQty" DECIMAL(12,4) NOT NULL,
    "usedQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "remainingQty" DECIMAL(12,4) NOT NULL,
    "purchaseCost" DECIMAL(12,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_item_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "branch_item_batches_branchId_idx" ON "branch_item_batches"("branchId");
CREATE INDEX "branch_item_batches_itemId_idx" ON "branch_item_batches"("itemId");
CREATE INDEX "branch_item_batches_variantId_idx" ON "branch_item_batches"("variantId");
CREATE INDEX "branch_item_batches_expiryDate_idx" ON "branch_item_batches"("expiryDate");

-- CreateTable: instrument_issue_logs
CREATE TABLE "instrument_issue_logs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "issuedToUserId" INTEGER,
    "procedureId" INTEGER,
    "issuedQty" DECIMAL(12,4) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedQty" DECIMAL(12,4),
    "returnedAt" TIMESTAMP(3),
    "sterilizationStatus" VARCHAR(32),
    "conditionNote" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_issue_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instrument_issue_logs_branchId_idx" ON "instrument_issue_logs"("branchId");
CREATE INDEX "instrument_issue_logs_itemId_idx" ON "instrument_issue_logs"("itemId");
CREATE INDEX "instrument_issue_logs_issuedToUserId_idx" ON "instrument_issue_logs"("issuedToUserId");

-- CreateTable: clinical_item_audit_logs
CREATE TABLE "clinical_item_audit_logs" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "actionType" "ItemAuditAction" NOT NULL,
    "oldDataJson" JSONB,
    "newDataJson" JSONB,
    "performedBy" INTEGER,
    "performedRole" VARCHAR(64),
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" VARCHAR(512),

    CONSTRAINT "clinical_item_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_item_audit_logs_itemId_idx" ON "clinical_item_audit_logs"("itemId");
CREATE INDEX "clinical_item_audit_logs_branchId_idx" ON "clinical_item_audit_logs"("branchId");
CREATE INDEX "clinical_item_audit_logs_performedAt_idx" ON "clinical_item_audit_logs"("performedAt");

-- CreateTable: clinical_item_approval_logs
CREATE TABLE "clinical_item_approval_logs" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "requestType" VARCHAR(64) NOT NULL,
    "requestedBy" INTEGER,
    "approvedBy" INTEGER,
    "status" "ItemApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "clinical_item_approval_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_item_approval_logs_itemId_idx" ON "clinical_item_approval_logs"("itemId");
CREATE INDEX "clinical_item_approval_logs_status_idx" ON "clinical_item_approval_logs"("status");

-- CreateTable: clinical_item_media
CREATE TABLE "clinical_item_media" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "mediaUrl" VARCHAR(512) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_item_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinical_item_media_itemId_idx" ON "clinical_item_media"("itemId");

-- CreateTable: clinical_item_branch_configs
CREATE TABLE "clinical_item_branch_configs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reorderLevel" DECIMAL(12,4),
    "maxLevel" DECIMAL(12,4),
    "preferredVendorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_item_branch_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_item_branch_configs_branchId_itemId_key" ON "clinical_item_branch_configs"("branchId", "itemId");
CREATE INDEX "clinical_item_branch_configs_branchId_idx" ON "clinical_item_branch_configs"("branchId");
CREATE INDEX "clinical_item_branch_configs_itemId_idx" ON "clinical_item_branch_configs"("itemId");

-- AlterTable: package_items - add clinical item refs
ALTER TABLE "package_items" ADD COLUMN "clinicalItemId" INTEGER;
ALTER TABLE "package_items" ADD COLUMN "clinicalItemVariantId" INTEGER;

-- AddForeignKey: clinical_item_categories
ALTER TABLE "clinical_item_categories" ADD CONSTRAINT "clinical_item_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_item_categories" ADD CONSTRAINT "clinical_item_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "clinical_item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: clinical_items
ALTER TABLE "clinical_items" ADD CONSTRAINT "clinical_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_items" ADD CONSTRAINT "clinical_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "clinical_item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_variants
ALTER TABLE "clinical_item_variants" ADD CONSTRAINT "clinical_item_variants_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: medicine_item_profiles
ALTER TABLE "medicine_item_profiles" ADD CONSTRAINT "medicine_item_profiles_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: consumable_item_profiles
ALTER TABLE "consumable_item_profiles" ADD CONSTRAINT "consumable_item_profiles_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: instrument_item_profiles
ALTER TABLE "instrument_item_profiles" ADD CONSTRAINT "instrument_item_profiles_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: branch_item_stocks
ALTER TABLE "branch_item_stocks" ADD CONSTRAINT "branch_item_stocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_item_stocks" ADD CONSTRAINT "branch_item_stocks_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_item_stocks" ADD CONSTRAINT "branch_item_stocks_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: branch_item_batches
ALTER TABLE "branch_item_batches" ADD CONSTRAINT "branch_item_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_item_batches" ADD CONSTRAINT "branch_item_batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_item_batches" ADD CONSTRAINT "branch_item_batches_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: instrument_issue_logs
ALTER TABLE "instrument_issue_logs" ADD CONSTRAINT "instrument_issue_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_audit_logs
ALTER TABLE "clinical_item_audit_logs" ADD CONSTRAINT "clinical_item_audit_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_approval_logs
ALTER TABLE "clinical_item_approval_logs" ADD CONSTRAINT "clinical_item_approval_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_media
ALTER TABLE "clinical_item_media" ADD CONSTRAINT "clinical_item_media_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_branch_configs
ALTER TABLE "clinical_item_branch_configs" ADD CONSTRAINT "clinical_item_branch_configs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_item_branch_configs" ADD CONSTRAINT "clinical_item_branch_configs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: package_items
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_clinicalItemVariantId_fkey" FOREIGN KEY ("clinicalItemVariantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
