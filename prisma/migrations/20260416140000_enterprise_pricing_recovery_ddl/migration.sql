-- Enterprise pricing recovery (additive). Aligns DB with schema for phases 1–8.
-- Safe to re-run partial failures only where IF NOT EXISTS / duplicate_object guards apply.

-- Enums (idempotent)
DO $$ BEGIN CREATE TYPE "PriceScheduleStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PriceChangeApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EnterpriseDiscountRuleKind" AS ENUM ('BRAND', 'CATEGORY', 'VARIANT', 'INVOICE_SLAB', 'BUNDLE', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EnterpriseDiscountScopeKind" AS ENUM ('ORG_WIDE', 'BRANCH_SPECIFIC'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EnterpriseDiscountTargetKind" AS ENUM ('BRAND', 'CATEGORY', 'VARIANT', 'ALL_PRODUCTS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EnterpriseDiscountMethod" AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'FIXED_PRICE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PricingCampaignType" AS ENUM ('FLASH_SALE', 'SEASONAL', 'CLEARANCE', 'BRAND_ACTIVATION', 'EXPIRY_LIQUIDATION', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PricingCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PriceApprovalTriggerKind" AS ENUM ('DISCOUNT_ABOVE_THRESHOLD', 'BELOW_FLOOR', 'BELOW_COST', 'BRANCH_OVERRIDE', 'CAMPAIGN_ACTIVATION', 'BULK_PRICE_UPDATE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BranchOverrideRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BatchPricingRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Org policy columns (phase 1)
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "blockSaleBelowCost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "blockSaleBelowFloor" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "allowCampaignStacking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "allowMembershipStacking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "scheduledPricingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "batchPricingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_pricing_policies" ADD COLUMN IF NOT EXISTS "defaultMaxDiscountPercent" DECIMAL(5,2);

-- Product pricing MRP (phase 2)
ALTER TABLE "product_pricings" ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(12,2);

-- Retail rule editor (phase 1)
ALTER TABLE "retail_discount_rules" ADD COLUMN IF NOT EXISTS "updatedByUserId" INTEGER;
DO $$ BEGIN
  ALTER TABLE "retail_discount_rules" ADD CONSTRAINT "retail_discount_rules_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Price schedules & approvals (phase 2)
CREATE TABLE IF NOT EXISTS "price_schedules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "newBasePrice" DECIMAL(12,2),
    "newMinPrice" DECIMAL(12,2),
    "newMaxPrice" DECIMAL(12,2),
    "newMrp" DECIMAL(12,2),
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "status" "PriceScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_schedules_orgId_effectiveAt_idx" ON "price_schedules"("orgId", "effectiveAt");
CREATE INDEX IF NOT EXISTS "price_schedules_status_idx" ON "price_schedules"("status");
DO $$ BEGIN
  ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "price_change_approval_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "currentBasePrice" DECIMAL(12,2),
    "proposedBasePrice" DECIMAL(12,2) NOT NULL,
    "proposedMinPrice" DECIMAL(12,2),
    "proposedMaxPrice" DECIMAL(12,2),
    "proposedMrp" DECIMAL(12,2),
    "reason" TEXT,
    "status" "PriceChangeApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_change_approval_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_change_approval_requests_orgId_status_idx" ON "price_change_approval_requests"("orgId", "status");
DO $$ BEGIN
  ALTER TABLE "price_change_approval_requests" ADD CONSTRAINT "price_change_approval_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_change_approval_requests" ADD CONSTRAINT "price_change_approval_requests_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_change_approval_requests" ADD CONSTRAINT "price_change_approval_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_change_approval_requests" ADD CONSTRAINT "price_change_approval_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enterprise discount rules (phase 3)
CREATE TABLE IF NOT EXISTS "enterprise_discount_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "ruleKind" "EnterpriseDiscountRuleKind" NOT NULL,
    "scopeKind" "EnterpriseDiscountScopeKind" NOT NULL DEFAULT 'ORG_WIDE',
    "scopeBranchId" INTEGER,
    "targetKind" "EnterpriseDiscountTargetKind" NOT NULL,
    "targetId" INTEGER,
    "discountMethod" "EnterpriseDiscountMethod" NOT NULL,
    "discountValue" DECIMAL(14,4) NOT NULL,
    "maxCapAmount" DECIMAL(12,2),
    "minQtyForSlab" INTEGER,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_discount_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "enterprise_discount_rules_orgId_status_idx" ON "enterprise_discount_rules"("orgId", "status");
DO $$ BEGIN
  ALTER TABLE "enterprise_discount_rules" ADD CONSTRAINT "enterprise_discount_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "enterprise_discount_rules" ADD CONSTRAINT "enterprise_discount_rules_scopeBranchId_fkey" FOREIGN KEY ("scopeBranchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "enterprise_discount_rules" ADD CONSTRAINT "enterprise_discount_rules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Membership (phase 4)
CREATE TABLE IF NOT EXISTS "membership_tiers" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "maxDiscountPerItem" DECIMAL(12,2),
    "maxDiscountPerInvoice" DECIMAL(12,2),
    "stackWithPromo" BOOLEAN NOT NULL DEFAULT false,
    "stackWithBrandDiscount" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "membership_tiers_orgId_name_key" ON "membership_tiers"("orgId", "name");
DO $$ BEGIN
  ALTER TABLE "membership_tiers" ADD CONSTRAINT "membership_tiers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "membership_tier_exclusions" (
    "id" SERIAL NOT NULL,
    "tierId" INTEGER NOT NULL,
    "excludeKind" VARCHAR(16) NOT NULL,
    "excludeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_tier_exclusions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "membership_tier_exclusions_tierId_idx" ON "membership_tier_exclusions"("tierId");
DO $$ BEGIN
  ALTER TABLE "membership_tier_exclusions" ADD CONSTRAINT "membership_tier_exclusions_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "membership_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "membership_tier_branch_scopes" (
    "id" SERIAL NOT NULL,
    "tierId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_tier_branch_scopes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "membership_tier_branch_scopes_tierId_branchId_key" ON "membership_tier_branch_scopes"("tierId", "branchId");
DO $$ BEGIN
  ALTER TABLE "membership_tier_branch_scopes" ADD CONSTRAINT "membership_tier_branch_scopes_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "membership_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "membership_tier_branch_scopes" ADD CONSTRAINT "membership_tier_branch_scopes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Owner discount cards: must exist before `pos_carts.ownerDiscountCardId` FK (20260420190000_pos_enterprise_cart_order_payment).
-- Previously referenced in this migration and in 20260501000000 before table existed (ordering bug). See docs/migration-governance-report.md.
CREATE TABLE IF NOT EXISTS "owner_discount_cards" (
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
    "membershipTierId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "owner_discount_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "owner_discount_cards_cardNumber_key" ON "owner_discount_cards"("cardNumber");
CREATE INDEX IF NOT EXISTS "owner_discount_cards_userId_idx" ON "owner_discount_cards"("userId");
CREATE INDEX IF NOT EXISTS "owner_discount_cards_orgId_idx" ON "owner_discount_cards"("orgId");
CREATE INDEX IF NOT EXISTS "owner_discount_cards_branchId_idx" ON "owner_discount_cards"("branchId");
CREATE INDEX IF NOT EXISTS "owner_discount_cards_cardNumber_idx" ON "owner_discount_cards"("cardNumber");
DO $$ BEGIN
  ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "owner_discount_cards" ADD CONSTRAINT "owner_discount_cards_membershipTierId_fkey" FOREIGN KEY ("membershipTierId") REFERENCES "membership_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Campaigns (phase 5)
CREATE TABLE IF NOT EXISTS "pricing_campaigns" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(64),
    "campaignType" "PricingCampaignType" NOT NULL DEFAULT 'OTHER',
    "discountMethod" "EnterpriseDiscountMethod" NOT NULL,
    "discountValue" DECIMAL(14,4) NOT NULL,
    "maxCapAmount" DECIMAL(12,2),
    "priority" INTEGER NOT NULL DEFAULT 50,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PricingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetAmount" DECIMAL(14,2),
    "usedAmount" DECIMAL(14,2) DEFAULT 0,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pricing_campaigns_orgId_status_idx" ON "pricing_campaigns"("orgId", "status");
CREATE INDEX IF NOT EXISTS "pricing_campaigns_orgId_code_idx" ON "pricing_campaigns"("orgId", "code");
DO $$ BEGIN
  ALTER TABLE "pricing_campaigns" ADD CONSTRAINT "pricing_campaigns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pricing_campaigns" ADD CONSTRAINT "pricing_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pricing_campaign_scopes" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "scopeKind" VARCHAR(16) NOT NULL,
    "scopeId" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_campaign_scopes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pricing_campaign_scopes_campaignId_idx" ON "pricing_campaign_scopes"("campaignId");
DO $$ BEGIN
  ALTER TABLE "pricing_campaign_scopes" ADD CONSTRAINT "pricing_campaign_scopes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "pricing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Branch override workflow (phase 6)
CREATE TABLE IF NOT EXISTS "price_approval_matrix_rows" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "triggerKind" "PriceApprovalTriggerKind" NOT NULL,
    "roleKey" VARCHAR(64) NOT NULL,
    "maxApprovalPercent" DECIMAL(5,2),
    "maxApprovalAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_approval_matrix_rows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "price_approval_matrix_rows_orgId_triggerKind_roleKey_key" ON "price_approval_matrix_rows"("orgId", "triggerKind", "roleKey");
DO $$ BEGIN
  ALTER TABLE "price_approval_matrix_rows" ADD CONSTRAINT "price_approval_matrix_rows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "branch_override_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "currentPrice" DECIMAL(12,2) NOT NULL,
    "requestedPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "status" "BranchOverrideRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "validityDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branch_override_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "branch_override_requests_orgId_status_idx" ON "branch_override_requests"("orgId", "status");
DO $$ BEGIN
  ALTER TABLE "branch_override_requests" ADD CONSTRAINT "branch_override_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "branch_override_requests" ADD CONSTRAINT "branch_override_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "branch_override_requests" ADD CONSTRAINT "branch_override_requests_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "branch_override_requests" ADD CONSTRAINT "branch_override_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "branch_override_requests" ADD CONSTRAINT "branch_override_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pricing_emergency_overrides" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "grantedUnitPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "consumedOrderId" INTEGER,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_emergency_overrides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pricing_emergency_overrides_orgId_expiresAt_idx" ON "pricing_emergency_overrides"("orgId", "expiresAt");
DO $$ BEGIN
  ALTER TABLE "pricing_emergency_overrides" ADD CONSTRAINT "pricing_emergency_overrides_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pricing_emergency_overrides" ADD CONSTRAINT "pricing_emergency_overrides_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pricing_emergency_overrides" ADD CONSTRAINT "pricing_emergency_overrides_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pricing_emergency_overrides" ADD CONSTRAINT "pricing_emergency_overrides_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "pricing_emergency_overrides" ADD CONSTRAINT "pricing_emergency_overrides_consumedOrderId_fkey" FOREIGN KEY ("consumedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Batch pricing (phase 7)
CREATE TABLE IF NOT EXISTS "batch_pricing_rules" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "recommendedSellPrice" DECIMAL(12,2),
    "promoPrice" DECIMAL(12,2),
    "liquidationReason" TEXT,
    "isExpiryDriven" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "status" "BatchPricingRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "batch_pricing_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "batch_pricing_rules_orgId_variantId_status_idx" ON "batch_pricing_rules"("orgId", "variantId", "status");
DO $$ BEGIN
  ALTER TABLE "batch_pricing_rules" ADD CONSTRAINT "batch_pricing_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "batch_pricing_rules" ADD CONSTRAINT "batch_pricing_rules_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "batch_pricing_rules" ADD CONSTRAINT "batch_pricing_rules_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Snapshots (phase 8)
CREATE TABLE IF NOT EXISTS "price_resolution_snapshots" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "basePrice" DECIMAL(12,2),
    "appliedRulesJson" JSONB,
    "finalPrice" DECIMAL(12,2) NOT NULL,
    "marginSnapshot" JSONB,
    "decisionTrace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "price_resolution_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "price_resolution_snapshots_orderId_idx" ON "price_resolution_snapshots"("orderId");
DO $$ BEGIN
  ALTER TABLE "price_resolution_snapshots" ADD CONSTRAINT "price_resolution_snapshots_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "price_resolution_snapshots" ADD CONSTRAINT "price_resolution_snapshots_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
