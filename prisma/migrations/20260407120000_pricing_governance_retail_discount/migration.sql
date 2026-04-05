-- Phase 3: Central pricing governance, audit trail, retail discount rules & approvals (additive)

CREATE TYPE "PricingAuditEntityType" AS ENUM (
  'PRODUCT_PRICING',
  'BRANCH_PRICING',
  'LOCATION_PRICE',
  'RETAIL_DISCOUNT_RULE',
  'ORG_PRICING_POLICY'
);

CREATE TYPE "RetailDiscountApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "org_pricing_policies" (
    "orgId" INTEGER NOT NULL,
    "enforceBranchOverrideWithinCentralBand" BOOLEAN NOT NULL DEFAULT true,
    "retailDiscountApprovalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "org_pricing_policies_pkey" PRIMARY KEY ("orgId")
);

CREATE TABLE "pricing_audit_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "entityType" "PricingAuditEntityType" NOT NULL,
    "entityKey" VARCHAR(128) NOT NULL,
    "actorUserId" INTEGER,
    "action" VARCHAR(64) NOT NULL,
    "payloadBefore" JSONB,
    "payloadAfter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "retail_discount_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "maxDiscountPercent" DECIMAL(5,2),
    "maxDiscountAmount" DECIMAL(12,2),
    "requiresApprovalAbovePercent" DECIMAL(5,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "validFrom" DATE,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retail_discount_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "retail_discount_approval_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "listPriceSnapshot" DECIMAL(12,2) NOT NULL,
    "requestedUnitPrice" DECIMAL(12,2) NOT NULL,
    "requestedDiscountPercent" DECIMAL(5,2),
    "reason" TEXT,
    "status" "RetailDiscountApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retail_discount_approval_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "org_pricing_policies" ADD CONSTRAINT "org_pricing_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_audit_logs" ADD CONSTRAINT "pricing_audit_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_audit_logs" ADD CONSTRAINT "pricing_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "retail_discount_rules" ADD CONSTRAINT "retail_discount_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retail_discount_rules" ADD CONSTRAINT "retail_discount_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retail_discount_rules" ADD CONSTRAINT "retail_discount_rules_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "retail_discount_approval_requests" ADD CONSTRAINT "retail_discount_approval_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retail_discount_approval_requests" ADD CONSTRAINT "retail_discount_approval_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retail_discount_approval_requests" ADD CONSTRAINT "retail_discount_approval_requests_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_discount_approval_requests" ADD CONSTRAINT "retail_discount_approval_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_discount_approval_requests" ADD CONSTRAINT "retail_discount_approval_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pricing_audit_logs_orgId_createdAt_idx" ON "pricing_audit_logs"("orgId", "createdAt");
CREATE INDEX "retail_discount_rules_orgId_variantId_idx" ON "retail_discount_rules"("orgId", "variantId");
CREATE INDEX "retail_discount_rules_branchId_idx" ON "retail_discount_rules"("branchId");
CREATE INDEX "retail_discount_approval_requests_orgId_status_idx" ON "retail_discount_approval_requests"("orgId", "status");
CREATE INDEX "retail_discount_approval_requests_branchId_status_idx" ON "retail_discount_approval_requests"("branchId", "status");
