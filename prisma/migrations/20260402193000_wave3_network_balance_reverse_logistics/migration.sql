-- Wave-3: Network balance, reverse logistics cases, recall campaigns, stock return disposition

-- CreateEnum
CREATE TYPE "RecallCampaignStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NetworkTransferRecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NetworkTransferTargetType" AS ENUM ('WTO', 'STOCK_REQUEST', 'NONE');

-- CreateEnum
CREATE TYPE "ReverseLogisticsCaseType" AS ENUM ('CUSTOMER', 'BRANCH_TO_DC', 'DC_TO_VENDOR', 'RECALL_RELATED');

-- CreateEnum
CREATE TYPE "ReverseLogisticsCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockReturnDisposition" AS ENUM ('PENDING', 'RESTOCK_SELLABLE', 'RESTOCK_QUARANTINE', 'RETURN_TO_VENDOR', 'DESTROY', 'REWORK', 'DISPUTED');

-- AlterTable batch_recalls
ALTER TABLE "batch_recalls" ADD COLUMN "campaignId" INTEGER;

-- AlterTable stock_returns
ALTER TABLE "stock_returns" ADD COLUMN "metaJson" JSONB;
ALTER TABLE "stock_returns" ADD COLUMN "disposition" "StockReturnDisposition" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "stock_returns" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "stock_returns" ADD COLUMN "linkedVendorReturnId" INTEGER;

-- CreateTable recall_campaigns
CREATE TABLE "recall_campaigns" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "externalRef" VARCHAR(200),
    "severity" "RecallSeverity" NOT NULL DEFAULT 'STANDARD',
    "status" "RecallCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "metaJson" JSONB,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable network_transfer_routes
CREATE TABLE "network_transfer_routes" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "fromLocationType" "InventoryLocationType" NOT NULL,
    "toLocationType" "InventoryLocationType" NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxQtyPerDay" INTEGER,
    "minMoveQty" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_transfer_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable network_balance_snapshots
CREATE TABLE "network_balance_snapshots" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rollupJson" JSONB NOT NULL,
    "aiJobRunId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable network_transfer_recommendations
CREATE TABLE "network_transfer_recommendations" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "fromLocationId" INTEGER NOT NULL,
    "toLocationId" INTEGER NOT NULL,
    "recommendedQty" INTEGER NOT NULL,
    "status" "NetworkTransferRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "targetEntityType" "NetworkTransferTargetType",
    "targetEntityId" INTEGER,
    "explainJson" JSONB NOT NULL DEFAULT '{}',
    "dayBucket" TIMESTAMP(3) NOT NULL,
    "suggestionHash" VARCHAR(64) NOT NULL,
    "dismissedByUserId" INTEGER,
    "acceptedByUserId" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_transfer_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable reverse_logistics_cases
CREATE TABLE "reverse_logistics_cases" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "caseType" "ReverseLogisticsCaseType" NOT NULL,
    "status" "ReverseLogisticsCaseStatus" NOT NULL DEFAULT 'OPEN',
    "primaryEntityType" VARCHAR(32) NOT NULL,
    "primaryEntityId" INTEGER NOT NULL,
    "metaJson" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reverse_logistics_cases_pkey" PRIMARY KEY ("id")
);

-- ForeignKeys
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "recall_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recall_campaigns" ADD CONSTRAINT "recall_campaigns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_campaigns" ADD CONSTRAINT "recall_campaigns_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_returns" ADD CONSTRAINT "stock_returns_linkedVendorReturnId_fkey" FOREIGN KEY ("linkedVendorReturnId") REFERENCES "vendor_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "network_transfer_routes" ADD CONSTRAINT "network_transfer_routes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "network_balance_snapshots" ADD CONSTRAINT "network_balance_snapshots_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_balance_snapshots" ADD CONSTRAINT "network_balance_snapshots_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "network_transfer_recommendations" ADD CONSTRAINT "network_transfer_recommendations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reverse_logistics_cases" ADD CONSTRAINT "reverse_logistics_cases_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reverse_logistics_cases" ADD CONSTRAINT "reverse_logistics_cases_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "network_transfer_routes_orgId_fromLocationType_toLocationType_key" ON "network_transfer_routes"("orgId", "fromLocationType", "toLocationType");
CREATE INDEX "network_transfer_routes_orgId_idx" ON "network_transfer_routes"("orgId");

CREATE INDEX "network_balance_snapshots_orgId_computedAt_idx" ON "network_balance_snapshots"("orgId", "computedAt");

CREATE UNIQUE INDEX "network_transfer_recommendations_orgId_suggestionHash_key" ON "network_transfer_recommendations"("orgId", "suggestionHash");
CREATE INDEX "network_transfer_recommendations_orgId_status_dayBucket_idx" ON "network_transfer_recommendations"("orgId", "status", "dayBucket");
CREATE INDEX "network_transfer_recommendations_variantId_fromLocationId_toLocatio_idx" ON "network_transfer_recommendations"("variantId", "fromLocationId", "toLocationId");

CREATE INDEX "recall_campaigns_orgId_status_idx" ON "recall_campaigns"("orgId", "status");

CREATE INDEX "batch_recalls_campaignId_idx" ON "batch_recalls"("campaignId");

CREATE INDEX "reverse_logistics_cases_orgId_status_idx" ON "reverse_logistics_cases"("orgId", "status");
CREATE INDEX "reverse_logistics_cases_primaryEntityType_primaryEntityId_idx" ON "reverse_logistics_cases"("primaryEntityType", "primaryEntityId");

CREATE INDEX "stock_returns_disposition_idx" ON "stock_returns"("disposition");
