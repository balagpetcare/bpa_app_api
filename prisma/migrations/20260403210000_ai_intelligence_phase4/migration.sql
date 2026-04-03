-- Phase 4: AI forecast, replenishment suggestions, procurement recommendations, job runs, overrides

CREATE TYPE "AiReplenishmentSuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');
CREATE TYPE "AiJobRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
CREATE TYPE "AiOverrideScope" AS ENUM ('VARIANT', 'BRANCH', 'ORG');

CREATE TABLE "ai_forecast_snapshots" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "forecastUnits" DECIMAL(14,4) NOT NULL,
    "avgDailyDemand" DECIMAL(14,6) NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "inputsJson" JSONB NOT NULL,
    "factorsJson" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_forecast_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_forecast_snapshots_orgId_branchId_variantId_horizonDays_key"
  ON "ai_forecast_snapshots"("orgId", "branchId", "variantId", "horizonDays");
CREATE INDEX "ai_forecast_snapshots_orgId_branchId_computedAt_idx" ON "ai_forecast_snapshots"("orgId", "branchId", "computedAt");
CREATE INDEX "ai_forecast_snapshots_variantId_idx" ON "ai_forecast_snapshots"("variantId");

ALTER TABLE "ai_forecast_snapshots" ADD CONSTRAINT "ai_forecast_snapshots_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_forecast_snapshots" ADD CONSTRAINT "ai_forecast_snapshots_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_forecast_snapshots" ADD CONSTRAINT "ai_forecast_snapshots_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_replenishment_suggestions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "suggestedQty" INTEGER NOT NULL,
    "onHand" INTEGER NOT NULL,
    "rop" INTEGER NOT NULL,
    "orderUpTo" INTEGER,
    "reasonCodes" JSONB NOT NULL DEFAULT '[]',
    "severity" VARCHAR(24),
    "status" "AiReplenishmentSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "stockRequestId" INTEGER,
    "suggestionHash" VARCHAR(64) NOT NULL,
    "dayBucket" TIMESTAMP(3) NOT NULL,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_replenishment_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_replenishment_suggestions_orgId_branchId_variantId_dayBucket_key"
  ON "ai_replenishment_suggestions"("orgId", "branchId", "variantId", "dayBucket");
CREATE INDEX "ai_replenishment_suggestions_orgId_branchId_status_idx" ON "ai_replenishment_suggestions"("orgId", "branchId", "status");
CREATE INDEX "ai_replenishment_suggestions_suggestionHash_idx" ON "ai_replenishment_suggestions"("suggestionHash");

ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_replenishment_suggestions" ADD CONSTRAINT "ai_replenishment_suggestions_stockRequestId_fkey"
  FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_procurement_recommendations" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "rankedVendorsJson" JSONB NOT NULL,
    "scoresJson" JSONB NOT NULL,
    "weightsJson" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_procurement_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_procurement_recommendations_orgId_branchId_variantId_key"
  ON "ai_procurement_recommendations"("orgId", "branchId", "variantId");
CREATE INDEX "ai_procurement_recommendations_orgId_computedAt_idx" ON "ai_procurement_recommendations"("orgId", "computedAt");

ALTER TABLE "ai_procurement_recommendations" ADD CONSTRAINT "ai_procurement_recommendations_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_procurement_recommendations" ADD CONSTRAINT "ai_procurement_recommendations_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_procurement_recommendations" ADD CONSTRAINT "ai_procurement_recommendations_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_job_runs" (
    "id" SERIAL NOT NULL,
    "jobType" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "AiJobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "statsJson" JSONB,
    "error" TEXT,

    CONSTRAINT "ai_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_job_runs_jobType_startedAt_idx" ON "ai_job_runs"("jobType", "startedAt");

CREATE TABLE "ai_recommendation_overrides" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "userId" INTEGER,
    "variantId" INTEGER,
    "scope" "AiOverrideScope" NOT NULL DEFAULT 'VARIANT',
    "leadTimeDays" INTEGER,
    "safetyDays" INTEGER,
    "dismissedUntil" TIMESTAMP(3),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recommendation_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_recommendation_overrides_orgId_branchId_idx" ON "ai_recommendation_overrides"("orgId", "branchId");
CREATE INDEX "ai_recommendation_overrides_userId_idx" ON "ai_recommendation_overrides"("userId");

ALTER TABLE "ai_recommendation_overrides" ADD CONSTRAINT "ai_recommendation_overrides_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_overrides" ADD CONSTRAINT "ai_recommendation_overrides_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_overrides" ADD CONSTRAINT "ai_recommendation_overrides_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_recommendation_overrides" ADD CONSTRAINT "ai_recommendation_overrides_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
