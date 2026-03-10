-- Enterprise: Surgery Package + Discount + Doctor Settlement
-- New enums
CREATE TYPE "PackageType" AS ENUM ('STANDARD', 'PREMIUM', 'WELFARE', 'EMERGENCY', 'PROMOTIONAL', 'DOCTOR_SPECIFIC', 'BRANCH_SPECIFIC');
CREATE TYPE "PackageItemType" AS ENUM ('INCLUDED', 'INFORMATIONAL', 'ADDON_ELIGIBLE');
CREATE TYPE "CostBucketType" AS ENUM ('DOCTOR_FEE', 'CLINIC_FACILITY', 'CONSUMABLE', 'MEDICATION', 'SUPPORT_ASSISTANT');
CREATE TYPE "DoctorContractType" AS ENUM ('REVENUE_SHARE', 'FIXED_FEE', 'VISITING_SPECIALIST', 'SALARY_INCENTIVE', 'WELFARE_NGO');
CREATE TYPE "DiscountType" AS ENUM ('CAMPAIGN', 'MANAGER', 'DOCTOR_DISCRETION', 'OWNER', 'PACKAGE', 'LOYALTY', 'WELFARE_RESCUE', 'PROMOTIONAL', 'BRANCH_EVENT');
CREATE TYPE "DiscountScope" AS ENUM ('WHOLE_INVOICE', 'SERVICE_LEVEL', 'PACKAGE_LEVEL', 'DOCTOR_FEE_EXCLUDED', 'CLINIC_FEE_ONLY', 'ADDON_ONLY', 'POST_OP_MEDS_ONLY');
CREATE TYPE "DiscountCalcType" AS ENUM ('PERCENTAGE', 'FLAT_AMOUNT', 'CAPPED_AMOUNT', 'CONDITIONAL', 'BUNDLE');
CREATE TYPE "DiscountAbsorptionMode" AS ENUM ('CLINIC_ABSORBS', 'PROPORTIONAL', 'DOCTOR_PROTECTED', 'APPROVAL_BASED_SPLIT');
CREATE TYPE "SettlementStatusEnterprise" AS ENUM ('PENDING_ACCRUAL', 'ACCRUED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'PARTIALLY_PAID', 'DISPUTED', 'REVERSED');
CREATE TYPE "SettlementCycle" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');
CREATE TYPE "ConsumptionMode" AS ENUM ('PLANNED', 'ACTUAL');
CREATE TYPE "ClinicalCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD');
CREATE TYPE "ProcedureOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ABORTED');

-- Alter Service: add enterprise columns
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "otRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "inventoryLinked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "packageAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "specialtyTag" VARCHAR(64);
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "doctorRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "estimatedCostJson" JSONB;

-- Alter DoctorSettlementLedger: add enterprise columns (nullable, no FK first)
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "caseId" INTEGER;
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "packageId" INTEGER;
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "discountImpact" DECIMAL(12,2);
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "supportShare" DECIMAL(12,2);
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "directCost" DECIMAL(12,2);
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "netDoctorEarning" DECIMAL(12,2);
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "batchId" INTEGER;
ALTER TABLE "doctor_settlement_ledger" ADD COLUMN IF NOT EXISTS "contractId" INTEGER;

-- New tables (order respects FK dependencies)
CREATE TABLE "surgery_packages" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "packageCode" VARCHAR(32) NOT NULL,
    "packageName" VARCHAR(128) NOT NULL,
    "packageType" "PackageType" NOT NULL DEFAULT 'STANDARD',
    "baseSellingPrice" DECIMAL(12,2) NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "doctorFeeAmount" DECIMAL(12,2),
    "clinicFeeAmount" DECIMAL(12,2),
    "consumableBlockAmount" DECIMAL(12,2),
    "medicationBlockAmount" DECIMAL(12,2),
    "supportFeeAmount" DECIMAL(12,2),
    "estimatedCost" DECIMAL(12,2),
    "emergencySurchargeRule" JSONB,
    "addOnAllowed" BOOLEAN NOT NULL DEFAULT true,
    "discountable" BOOLEAN NOT NULL DEFAULT true,
    "speciesCondition" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgery_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surgery_packages_packageCode_key" ON "surgery_packages"("packageCode");
CREATE INDEX "surgery_packages_orgId_branchId_idx" ON "surgery_packages"("orgId", "branchId");
CREATE INDEX "surgery_packages_branchId_serviceId_idx" ON "surgery_packages"("branchId", "serviceId");
CREATE INDEX "surgery_packages_packageCode_idx" ON "surgery_packages"("packageCode");

CREATE TABLE "package_items" (
    "id" SERIAL NOT NULL,
    "surgeryPackageId" INTEGER NOT NULL,
    "itemType" "PackageItemType" NOT NULL,
    "productId" INTEGER,
    "variantId" INTEGER,
    "estimatedQty" DECIMAL(12,4),
    "estimatedCost" DECIMAL(12,2),
    "displayLabel" VARCHAR(128),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "package_price_rules" (
    "id" SERIAL NOT NULL,
    "surgeryPackageId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "species" VARCHAR(32),
    "weightBandJson" JSONB,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "priceOverride" DECIMAL(12,2) NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_price_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "package_price_change_logs" (
    "id" SERIAL NOT NULL,
    "surgeryPackageId" INTEGER NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "changedByUserId" INTEGER NOT NULL,
    "reason" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_price_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "branch_overhead_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "ruleType" VARCHAR(32) NOT NULL,
    "amountType" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "applicableFrom" DATE,
    "applicableTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_overhead_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_policies" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "scope" "DiscountScope" NOT NULL,
    "calcType" "DiscountCalcType" NOT NULL,
    "maxPercent" DECIMAL(5,2),
    "maxAmount" DECIMAL(12,2),
    "absorptionMode" "DiscountAbsorptionMode" NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "serviceIds" JSONB,
    "packageIds" JSONB,
    "validFrom" DATE,
    "validTo" DATE,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_approval_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "roleKey" VARCHAR(64) NOT NULL,
    "maxPercent" DECIMAL(5,2) NOT NULL,
    "maxAmount" DECIMAL(12,2),
    "appliesToScope" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_approval_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinical_cases" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "visitId" INTEGER,
    "patientId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "surgeryPackageId" INTEGER,
    "status" "ClinicalCaseStatus" NOT NULL DEFAULT 'OPEN',
    "totalCharges" DECIMAL(12,2),
    "totalCollected" DECIMAL(12,2),
    "primaryDoctorId" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_cases_appointmentId_key" ON "clinical_cases"("appointmentId");
CREATE UNIQUE INDEX "clinical_cases_visitId_key" ON "clinical_cases"("visitId");
CREATE INDEX "clinical_cases_branchId_status_idx" ON "clinical_cases"("branchId", "status");
CREATE INDEX "clinical_cases_patientId_idx" ON "clinical_cases"("patientId");
CREATE INDEX "clinical_cases_visitId_idx" ON "clinical_cases"("visitId");
CREATE INDEX "clinical_cases_appointmentId_idx" ON "clinical_cases"("appointmentId");

CREATE TABLE "procedure_orders" (
    "id" SERIAL NOT NULL,
    "clinicalCaseId" INTEGER NOT NULL,
    "surgeryPackageId" INTEGER,
    "doctorId" INTEGER NOT NULL,
    "status" "ProcedureOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "actualCostRecorded" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procedure_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "applied_discounts" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "clinicalCaseId" INTEGER,
    "discountPolicyId" INTEGER NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "calcType" "DiscountCalcType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "percentApplied" DECIMAL(5,2),
    "absorptionBreakdown" JSONB,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "reason" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applied_discounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discount_audit_logs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "discountPolicyId" INTEGER,
    "orderId" INTEGER,
    "caseId" INTEGER,
    "amount" DECIMAL(12,2),
    "byUserId" INTEGER,
    "roleKey" VARCHAR(64),
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "case_cost_sheets" (
    "id" SERIAL NOT NULL,
    "clinicalCaseId" INTEGER NOT NULL,
    "directCost" DECIMAL(12,2) NOT NULL,
    "semiDirectCost" DECIMAL(12,2),
    "overheadAllocated" DECIMAL(12,2),
    "distributableMargin" DECIMAL(12,2) NOT NULL,
    "doctorShare" DECIMAL(12,2),
    "clinicShare" DECIMAL(12,2),
    "supportShare" DECIMAL(12,2),
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_cost_sheets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_consumptions" (
    "id" SERIAL NOT NULL,
    "clinicalCaseId" INTEGER,
    "procedureOrderId" INTEGER,
    "visitId" INTEGER,
    "mode" "ConsumptionMode" NOT NULL DEFAULT 'PLANNED',
    "status" VARCHAR(16) NOT NULL DEFAULT 'RECORDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consumption_items" (
    "id" SERIAL NOT NULL,
    "inventoryConsumptionId" INTEGER NOT NULL,
    "productId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "quantityPlanned" DECIMAL(12,4),
    "quantityActual" DECIMAL(12,4),
    "unitCost" DECIMAL(12,2),
    "wastageFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vial_return_controls" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalCaseId" INTEGER,
    "procedureOrderId" INTEGER,
    "visitId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL,
    "returnDueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "auditHoldDays" INTEGER NOT NULL DEFAULT 7,
    "missingAlertAt" TIMESTAMP(3),
    "nextIssueBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vial_return_controls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinic_invoices" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "clinicalCaseId" INTEGER,
    "surgeryPackageId" INTEGER,
    "doctorFeeAmount" DECIMAL(12,2),
    "clinicShareAmount" DECIMAL(12,2),
    "supportFeeAmount" DECIMAL(12,2),
    "consumableCost" DECIMAL(12,2),
    "discountApplied" DECIMAL(12,2),
    "settlementRef" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinic_invoices_orderId_key" ON "clinic_invoices"("orderId");
CREATE INDEX "clinic_invoices_clinicalCaseId_idx" ON "clinic_invoices"("clinicalCaseId");

CREATE TABLE "invoice_cost_sheets" (
    "id" SERIAL NOT NULL,
    "clinicInvoiceId" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "directCost" DECIMAL(12,2) NOT NULL,
    "distributableMargin" DECIMAL(12,2) NOT NULL,
    "doctorShare" DECIMAL(12,2) NOT NULL,
    "clinicShare" DECIMAL(12,2) NOT NULL,
    "supportShare" DECIMAL(12,2) NOT NULL,
    "grossProfit" DECIMAL(12,2),
    "snapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_cost_sheets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "doctor_contracts" (
    "id" SERIAL NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "contractType" "DoctorContractType" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "consultationRule" JSONB,
    "surgeryRule" JSONB,
    "emergencyRule" JSONB,
    "discountImpactRule" JSONB,
    "payoutFrequency" "SettlementCycle" NOT NULL DEFAULT 'MONTHLY',
    "thresholdIncentiveJson" JSONB,
    "serviceApplicability" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "doctor_contract_rules" (
    "id" SERIAL NOT NULL,
    "doctorContractId" INTEGER NOT NULL,
    "serviceId" INTEGER,
    "category" VARCHAR(32),
    "rateType" VARCHAR(32) NOT NULL,
    "rateValue" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_contract_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "doctor_settlement_batches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicStaffProfileId" INTEGER NOT NULL,
    "contractId" INTEGER,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalAccrued" DECIMAL(12,2) NOT NULL,
    "totalAdjustments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_settlement_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_payments" (
    "id" SERIAL NOT NULL,
    "settlementBatchId" INTEGER NOT NULL,
    "paymentMethod" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidByUserId" INTEGER,
    "receiptRef" VARCHAR(128),
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_adjustments" (
    "id" SERIAL NOT NULL,
    "settlementBatchId" INTEGER NOT NULL,
    "ledgerId" INTEGER,
    "adjustmentType" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_audit_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "settlementBatchId" INTEGER,
    "ledgerId" INTEGER,
    "byUserId" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_variance_logs" (
    "id" SERIAL NOT NULL,
    "inventoryConsumptionId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantityPlanned" DECIMAL(12,4) NOT NULL,
    "quantityActual" DECIMAL(12,4) NOT NULL,
    "variance" DECIMAL(12,4) NOT NULL,
    "varianceCost" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_variance_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_action_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "byUserId" INTEGER NOT NULL,
    "roleKey" VARCHAR(64),
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_action_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "clinic_finance_configs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "settlementCycle" "SettlementCycle" NOT NULL DEFAULT 'MONTHLY',
    "discountLimitDefaultPct" DECIMAL(5,2),
    "overheadAllocationMethod" VARCHAR(32),
    "caseCompletionRule" VARCHAR(64),
    "vialReturnDays" INTEGER DEFAULT 7,
    "stockIssueAuditLock" BOOLEAN NOT NULL DEFAULT false,
    "billEditRestrictionAfterClose" BOOLEAN NOT NULL DEFAULT true,
    "doctorFeeEditRestricted" BOOLEAN NOT NULL DEFAULT true,
    "configJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_finance_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinic_finance_configs_branchId_key" ON "clinic_finance_configs"("branchId");

-- Indexes for new tables
CREATE INDEX "package_items_surgeryPackageId_idx" ON "package_items"("surgeryPackageId");
CREATE INDEX "package_price_rules_surgeryPackageId_idx" ON "package_price_rules"("surgeryPackageId");
CREATE INDEX "package_price_rules_branchId_idx" ON "package_price_rules"("branchId");
CREATE INDEX "package_price_change_logs_surgeryPackageId_idx" ON "package_price_change_logs"("surgeryPackageId");
CREATE INDEX "branch_overhead_rules_branchId_idx" ON "branch_overhead_rules"("branchId");
CREATE INDEX "discount_policies_branchId_idx" ON "discount_policies"("branchId");
CREATE UNIQUE INDEX "discount_approval_rules_branchId_roleKey_appliesToScope_key" ON "discount_approval_rules"("branchId", "roleKey", "appliesToScope");
CREATE INDEX "discount_approval_rules_branchId_idx" ON "discount_approval_rules"("branchId");
CREATE INDEX "procedure_orders_clinicalCaseId_idx" ON "procedure_orders"("clinicalCaseId");
CREATE INDEX "procedure_orders_doctorId_idx" ON "procedure_orders"("doctorId");
CREATE INDEX "procedure_orders_status_idx" ON "procedure_orders"("status");
CREATE INDEX "applied_discounts_orderId_idx" ON "applied_discounts"("orderId");
CREATE INDEX "applied_discounts_clinicalCaseId_idx" ON "applied_discounts"("clinicalCaseId");
CREATE INDEX "discount_audit_logs_branchId_idx" ON "discount_audit_logs"("branchId");
CREATE INDEX "discount_audit_logs_createdAt_idx" ON "discount_audit_logs"("createdAt");
CREATE INDEX "case_cost_sheets_clinicalCaseId_idx" ON "case_cost_sheets"("clinicalCaseId");
CREATE INDEX "inventory_consumptions_clinicalCaseId_idx" ON "inventory_consumptions"("clinicalCaseId");
CREATE INDEX "inventory_consumptions_procedureOrderId_idx" ON "inventory_consumptions"("procedureOrderId");
CREATE INDEX "inventory_consumptions_visitId_idx" ON "inventory_consumptions"("visitId");
CREATE INDEX "consumption_items_inventoryConsumptionId_idx" ON "consumption_items"("inventoryConsumptionId");
CREATE INDEX "consumption_items_variantId_idx" ON "consumption_items"("variantId");
CREATE INDEX "vial_return_controls_branchId_idx" ON "vial_return_controls"("branchId");
CREATE INDEX "vial_return_controls_clinicalCaseId_idx" ON "vial_return_controls"("clinicalCaseId");
CREATE INDEX "vial_return_controls_returnDueAt_idx" ON "vial_return_controls"("returnDueAt");
CREATE INDEX "invoice_cost_sheets_clinicInvoiceId_idx" ON "invoice_cost_sheets"("clinicInvoiceId");
CREATE INDEX "doctor_contracts_clinicStaffProfileId_idx" ON "doctor_contracts"("clinicStaffProfileId");
CREATE INDEX "doctor_contracts_branchId_idx" ON "doctor_contracts"("branchId");
CREATE INDEX "doctor_contract_rules_doctorContractId_idx" ON "doctor_contract_rules"("doctorContractId");
CREATE INDEX "doctor_contract_rules_serviceId_idx" ON "doctor_contract_rules"("serviceId");
CREATE INDEX "doctor_settlement_batches_clinicStaffProfileId_idx" ON "doctor_settlement_batches"("clinicStaffProfileId");
CREATE INDEX "doctor_settlement_batches_branchId_periodStart_periodEnd_idx" ON "doctor_settlement_batches"("branchId", "periodStart", "periodEnd");
CREATE INDEX "settlement_payments_settlementBatchId_idx" ON "settlement_payments"("settlementBatchId");
CREATE INDEX "settlement_adjustments_settlementBatchId_idx" ON "settlement_adjustments"("settlementBatchId");
CREATE INDEX "settlement_audit_logs_branchId_idx" ON "settlement_audit_logs"("branchId");
CREATE INDEX "settlement_audit_logs_createdAt_idx" ON "settlement_audit_logs"("createdAt");
CREATE INDEX "inventory_variance_logs_inventoryConsumptionId_idx" ON "inventory_variance_logs"("inventoryConsumptionId");
CREATE INDEX "approval_action_logs_branchId_entityType_idx" ON "approval_action_logs"("branchId", "entityType");

-- Add foreign keys for new tables
ALTER TABLE "surgery_packages" ADD CONSTRAINT "surgery_packages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_packages" ADD CONSTRAINT "surgery_packages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_packages" ADD CONSTRAINT "surgery_packages_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "package_items" ADD CONSTRAINT "package_items_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "package_price_rules" ADD CONSTRAINT "package_price_rules_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_price_rules" ADD CONSTRAINT "package_price_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "package_price_change_logs" ADD CONSTRAINT "package_price_change_logs_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_price_change_logs" ADD CONSTRAINT "package_price_change_logs_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "branch_overhead_rules" ADD CONSTRAINT "branch_overhead_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_overhead_rules" ADD CONSTRAINT "branch_overhead_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_policies" ADD CONSTRAINT "discount_policies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discount_approval_rules" ADD CONSTRAINT "discount_approval_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discount_approval_rules" ADD CONSTRAINT "discount_approval_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_cases" ADD CONSTRAINT "clinical_cases_primaryDoctorId_fkey" FOREIGN KEY ("primaryDoctorId") REFERENCES "branch_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "procedure_orders" ADD CONSTRAINT "procedure_orders_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "procedure_orders" ADD CONSTRAINT "procedure_orders_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "procedure_orders" ADD CONSTRAINT "procedure_orders_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "applied_discounts" ADD CONSTRAINT "applied_discounts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "applied_discounts" ADD CONSTRAINT "applied_discounts_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "applied_discounts" ADD CONSTRAINT "applied_discounts_discountPolicyId_fkey" FOREIGN KEY ("discountPolicyId") REFERENCES "discount_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applied_discounts" ADD CONSTRAINT "applied_discounts_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "discount_audit_logs" ADD CONSTRAINT "discount_audit_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_cost_sheets" ADD CONSTRAINT "case_cost_sheets_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_procedureOrderId_fkey" FOREIGN KEY ("procedureOrderId") REFERENCES "procedure_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_inventoryConsumptionId_fkey" FOREIGN KEY ("inventoryConsumptionId") REFERENCES "inventory_consumptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_items" ADD CONSTRAINT "consumption_items_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vial_return_controls" ADD CONSTRAINT "vial_return_controls_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vial_return_controls" ADD CONSTRAINT "vial_return_controls_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vial_return_controls" ADD CONSTRAINT "vial_return_controls_procedureOrderId_fkey" FOREIGN KEY ("procedureOrderId") REFERENCES "procedure_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vial_return_controls" ADD CONSTRAINT "vial_return_controls_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vial_return_controls" ADD CONSTRAINT "vial_return_controls_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_clinicalCaseId_fkey" FOREIGN KEY ("clinicalCaseId") REFERENCES "clinical_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_cost_sheets" ADD CONSTRAINT "invoice_cost_sheets_clinicInvoiceId_fkey" FOREIGN KEY ("clinicInvoiceId") REFERENCES "clinic_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_contracts" ADD CONSTRAINT "doctor_contracts_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_contracts" ADD CONSTRAINT "doctor_contracts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_contract_rules" ADD CONSTRAINT "doctor_contract_rules_doctorContractId_fkey" FOREIGN KEY ("doctorContractId") REFERENCES "doctor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_contract_rules" ADD CONSTRAINT "doctor_contract_rules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "doctor_settlement_batches" ADD CONSTRAINT "doctor_settlement_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_batches" ADD CONSTRAINT "doctor_settlement_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_batches" ADD CONSTRAINT "doctor_settlement_batches_clinicStaffProfileId_fkey" FOREIGN KEY ("clinicStaffProfileId") REFERENCES "clinic_staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_batches" ADD CONSTRAINT "doctor_settlement_batches_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "doctor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "doctor_settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_payments" ADD CONSTRAINT "settlement_payments_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "doctor_settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "doctor_settlement_ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "settlement_audit_logs" ADD CONSTRAINT "settlement_audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_audit_logs" ADD CONSTRAINT "settlement_audit_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_variance_logs" ADD CONSTRAINT "inventory_variance_logs_inventoryConsumptionId_fkey" FOREIGN KEY ("inventoryConsumptionId") REFERENCES "inventory_consumptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_variance_logs" ADD CONSTRAINT "inventory_variance_logs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_action_logs" ADD CONSTRAINT "approval_action_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_action_logs" ADD CONSTRAINT "approval_action_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinic_finance_configs" ADD CONSTRAINT "clinic_finance_configs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DoctorSettlementLedger foreign keys for new columns
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "clinical_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "doctor_settlement_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "doctor_settlement_ledger" ADD CONSTRAINT "doctor_settlement_ledger_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "doctor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "doctor_settlement_ledger_caseId_idx" ON "doctor_settlement_ledger"("caseId");
CREATE INDEX "doctor_settlement_ledger_batchId_idx" ON "doctor_settlement_ledger"("batchId");
