-- CreateTable: clinical_stock_audits
CREATE TABLE IF NOT EXISTS "clinical_stock_audits" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "auditNo" VARCHAR(32) NOT NULL,
    "auditScope" VARCHAR(24) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "initiatedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_stock_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinical_stock_audits_auditNo_key" ON "clinical_stock_audits"("auditNo");
CREATE INDEX IF NOT EXISTS "clinical_stock_audits_orgId_idx" ON "clinical_stock_audits"("orgId");
CREATE INDEX IF NOT EXISTS "clinical_stock_audits_branchId_idx" ON "clinical_stock_audits"("branchId");
CREATE INDEX IF NOT EXISTS "clinical_stock_audits_status_idx" ON "clinical_stock_audits"("status");

ALTER TABLE "clinical_stock_audits" ADD CONSTRAINT "clinical_stock_audits_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_audits" ADD CONSTRAINT "clinical_stock_audits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_audits" ADD CONSTRAINT "clinical_stock_audits_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_audits" ADD CONSTRAINT "clinical_stock_audits_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: clinical_stock_audit_lines
CREATE TABLE IF NOT EXISTS "clinical_stock_audit_lines" (
    "id" SERIAL NOT NULL,
    "auditId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "batchNo" VARCHAR(64),
    "systemQty" INTEGER NOT NULL,
    "physicalQty" INTEGER,
    "varianceQty" INTEGER,
    "varianceReason" VARCHAR(256),
    "resolutionStatus" VARCHAR(24),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_stock_audit_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_stock_audit_lines_auditId_idx" ON "clinical_stock_audit_lines"("auditId");
CREATE INDEX IF NOT EXISTS "clinical_stock_audit_lines_clinicalItemId_idx" ON "clinical_stock_audit_lines"("clinicalItemId");

ALTER TABLE "clinical_stock_audit_lines" ADD CONSTRAINT "clinical_stock_audit_lines_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "clinical_stock_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_audit_lines" ADD CONSTRAINT "clinical_stock_audit_lines_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_stock_audit_lines" ADD CONSTRAINT "clinical_stock_audit_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: clinical_wastage_logs
CREATE TABLE IF NOT EXISTS "clinical_wastage_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "batchNo" VARCHAR(64),
    "wastageType" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" VARCHAR(512),
    "reportedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_wastage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinical_wastage_logs_orgId_idx" ON "clinical_wastage_logs"("orgId");
CREATE INDEX IF NOT EXISTS "clinical_wastage_logs_branchId_idx" ON "clinical_wastage_logs"("branchId");
CREATE INDEX IF NOT EXISTS "clinical_wastage_logs_clinicalItemId_idx" ON "clinical_wastage_logs"("clinicalItemId");
CREATE INDEX IF NOT EXISTS "clinical_wastage_logs_status_idx" ON "clinical_wastage_logs"("status");

ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_wastage_logs" ADD CONSTRAINT "clinical_wastage_logs_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: replenishment_recommendations
CREATE TABLE IF NOT EXISTS "replenishment_recommendations" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "avgDailyUsage" DECIMAL(12,4) NOT NULL,
    "avgMonthlyUsage" DECIMAL(12,4) NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "recommendedQty" INTEGER NOT NULL,
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "replenishment_recommendations_orgId_idx" ON "replenishment_recommendations"("orgId");
CREATE INDEX IF NOT EXISTS "replenishment_recommendations_branchId_idx" ON "replenishment_recommendations"("branchId");
CREATE INDEX IF NOT EXISTS "replenishment_recommendations_clinicalItemId_idx" ON "replenishment_recommendations"("clinicalItemId");
CREATE INDEX IF NOT EXISTS "replenishment_recommendations_status_idx" ON "replenishment_recommendations"("status");

ALTER TABLE "replenishment_recommendations" ADD CONSTRAINT "replenishment_recommendations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "replenishment_recommendations" ADD CONSTRAINT "replenishment_recommendations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "replenishment_recommendations" ADD CONSTRAINT "replenishment_recommendations_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "replenishment_recommendations" ADD CONSTRAINT "replenishment_recommendations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
