-- Wave-4: Financial intelligence, CTS, SLA measurements, operational exception command center (additive)

CREATE TYPE "FinIntelCostGrain" AS ENUM ('GRN_LINE', 'VARIANT_BRANCH_PERIOD', 'DISPATCH');
CREATE TYPE "FinIntelCostComponent" AS ENUM ('MATERIAL', 'INBOUND_ALLOC', 'TRANSFER_PROXY', 'SHRINK', 'LABOR_FACILITY');
CREATE TYPE "SloMeasurementDomain" AS ENUM ('INVENTORY', 'SUPPORT', 'RECALL', 'PROCUREMENT', 'CLINIC_QUEUE');
CREATE TYPE "SloTargetKind" AS ENUM ('TIME_TO_COMPLETE', 'PERCENT_WITHIN_WINDOW', 'COUNT_BREACH');
CREATE TYPE "OpsExceptionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "OpsExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'SNOOZED');
CREATE TYPE "OpsRcaPrimaryCause" AS ENUM ('DATA_ENTRY', 'SYSTEM_BUG', 'VENDOR_SHORT', 'THEFT', 'TRAINING', 'UNKNOWN', 'OTHER');

CREATE TABLE "cost_allocation_policies" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "methodJson" JSONB NOT NULL DEFAULT '{}',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "costModelVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_allocation_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_driver_inputs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "laborHours" DECIMAL(12,2),
    "facilityCost" DECIMAL(14,2),
    "currency" VARCHAR(8) NOT NULL DEFAULT 'BDT',
    "notes" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_driver_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_facts" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "grain" "FinIntelCostGrain" NOT NULL,
    "component" "FinIntelCostComponent" NOT NULL,
    "variantId" INTEGER,
    "locationId" INTEGER,
    "branchId" INTEGER,
    "refType" VARCHAR(64) NOT NULL,
    "refId" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(16,4) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'BDT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "inputsJson" JSONB NOT NULL DEFAULT '{}',
    "methodVersion" INTEGER NOT NULL DEFAULT 1,
    "costAllocationPolicyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_facts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cts_summaries" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalMaterial" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "totalAllocated" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "unitsBasis" INTEGER,
    "unitCts" DECIMAL(16,6),
    "confidence" DECIMAL(5,4),
    "methodVersion" INTEGER NOT NULL DEFAULT 1,
    "breakdownJson" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cts_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_level_objectives" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "sloKey" VARCHAR(80) NOT NULL,
    "domain" "SloMeasurementDomain" NOT NULL,
    "targetKind" "SloTargetKind" NOT NULL,
    "targetValue" DECIMAL(12,4) NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metaJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_level_objectives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slo_measurements" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "sloId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "measuredValue" DECIMAL(14,6),
    "breachCount" INTEGER NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "calculationTrace" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "slo_measurements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exception_severity_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "exceptionCode" VARCHAR(80) NOT NULL,
    "ruleJson" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "exception_severity_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_exception_indices" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "exceptionCode" VARCHAR(80) NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "severity" "OpsExceptionSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "OpsExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "branchId" INTEGER,
    "sourceRefType" VARCHAR(64) NOT NULL,
    "sourceRefId" VARCHAR(64) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "assignedToUserId" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "timelineJson" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "breachFlag" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operational_exception_indices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_exception_rcas" (
    "id" SERIAL NOT NULL,
    "operationalExceptionId" INTEGER NOT NULL,
    "primaryCause" "OpsRcaPrimaryCause" NOT NULL DEFAULT 'UNKNOWN',
    "contributingFactorsJson" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operational_exception_rcas_pkey" PRIMARY KEY ("id")
);

-- FKs
ALTER TABLE "cost_allocation_policies" ADD CONSTRAINT "cost_allocation_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_driver_inputs" ADD CONSTRAINT "cost_driver_inputs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_driver_inputs" ADD CONSTRAINT "cost_driver_inputs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_facts" ADD CONSTRAINT "cost_facts_costAllocationPolicyId_fkey" FOREIGN KEY ("costAllocationPolicyId") REFERENCES "cost_allocation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cts_summaries" ADD CONSTRAINT "cts_summaries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cts_summaries" ADD CONSTRAINT "cts_summaries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cts_summaries" ADD CONSTRAINT "cts_summaries_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_level_objectives" ADD CONSTRAINT "service_level_objectives_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slo_measurements" ADD CONSTRAINT "slo_measurements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slo_measurements" ADD CONSTRAINT "slo_measurements_sloId_fkey" FOREIGN KEY ("sloId") REFERENCES "service_level_objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exception_severity_rules" ADD CONSTRAINT "exception_severity_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_exception_indices" ADD CONSTRAINT "operational_exception_indices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_exception_indices" ADD CONSTRAINT "operational_exception_indices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_exception_indices" ADD CONSTRAINT "operational_exception_indices_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_exception_rcas" ADD CONSTRAINT "operational_exception_rcas_operationalExceptionId_fkey" FOREIGN KEY ("operationalExceptionId") REFERENCES "operational_exception_indices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_exception_rcas" ADD CONSTRAINT "operational_exception_rcas_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cost_allocation_policies_orgId_isActive_idx" ON "cost_allocation_policies"("orgId", "isActive");
CREATE INDEX "cost_driver_inputs_orgId_periodStart_idx" ON "cost_driver_inputs"("orgId", "periodStart");
CREATE INDEX "cost_driver_inputs_branchId_idx" ON "cost_driver_inputs"("branchId");
CREATE INDEX "cost_facts_orgId_periodStart_periodEnd_idx" ON "cost_facts"("orgId", "periodStart", "periodEnd");
CREATE INDEX "cost_facts_orgId_variantId_idx" ON "cost_facts"("orgId", "variantId");
CREATE INDEX "cost_facts_refType_refId_idx" ON "cost_facts"("refType", "refId");
CREATE UNIQUE INDEX "cts_summaries_orgId_branchId_variantId_periodStart_periodEnd_key" ON "cts_summaries"("orgId", "branchId", "variantId", "periodStart", "periodEnd");
CREATE INDEX "cts_summaries_orgId_periodStart_idx" ON "cts_summaries"("orgId", "periodStart");
CREATE UNIQUE INDEX "service_level_objectives_orgId_sloKey_key" ON "service_level_objectives"("orgId", "sloKey");
CREATE INDEX "service_level_objectives_orgId_domain_idx" ON "service_level_objectives"("orgId", "domain");
CREATE INDEX "slo_measurements_orgId_periodStart_idx" ON "slo_measurements"("orgId", "periodStart");
CREATE INDEX "slo_measurements_sloId_idx" ON "slo_measurements"("sloId");
CREATE INDEX "exception_severity_rules_orgId_exceptionCode_idx" ON "exception_severity_rules"("orgId", "exceptionCode");
CREATE UNIQUE INDEX "operational_exception_indices_orgId_sourceRefType_sourceRefId_key" ON "operational_exception_indices"("orgId", "sourceRefType", "sourceRefId");
CREATE INDEX "operational_exception_indices_orgId_status_severity_idx" ON "operational_exception_indices"("orgId", "status", "severity");
CREATE INDEX "operational_exception_indices_orgId_branchId_openedAt_idx" ON "operational_exception_indices"("orgId", "branchId", "openedAt");
CREATE INDEX "operational_exception_indices_assignedToUserId_idx" ON "operational_exception_indices"("assignedToUserId");
CREATE UNIQUE INDEX "operational_exception_rcas_operationalExceptionId_key" ON "operational_exception_rcas"("operationalExceptionId");
