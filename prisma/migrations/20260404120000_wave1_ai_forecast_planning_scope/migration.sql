-- Wave-1: forecast snapshots scoped to whole branch or a single warehouse (additive, non-destructive)

CREATE TYPE "AiPlanningScope" AS ENUM ('BRANCH', 'WAREHOUSE');

ALTER TABLE "ai_forecast_snapshots" ADD COLUMN "planningScope" "AiPlanningScope" NOT NULL DEFAULT 'BRANCH';
ALTER TABLE "ai_forecast_snapshots" ADD COLUMN "scopeWarehouseId" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "ai_forecast_snapshots_orgId_branchId_variantId_horizonDays_key";

CREATE UNIQUE INDEX "ai_forecast_snapshots_orgId_branchId_variantId_horizonDays_planningScope_scopeWarehouseId_key"
  ON "ai_forecast_snapshots"("orgId", "branchId", "variantId", "horizonDays", "planningScope", "scopeWarehouseId");

CREATE INDEX "ai_forecast_snapshots_orgId_branchId_planningScope_scopeWarehouseId_computedAt_idx"
  ON "ai_forecast_snapshots"("orgId", "branchId", "planningScope", "scopeWarehouseId", "computedAt");
