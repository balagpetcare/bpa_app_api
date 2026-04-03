-- Wave-5: Executive control tower, decision packages, scenario runs (read-only simulation results)

CREATE TYPE "DecisionPackageStatus" AS ENUM ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DEFERRED', 'SUPERSEDED');
CREATE TYPE "DecisionPackageItemState" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "DecisionApprovalEventType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'DEFERRED', 'OVERRIDE', 'ESCALATED');
CREATE TYPE "ScenarioRunStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "decision_packages" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "status" "DecisionPackageStatus" NOT NULL DEFAULT 'PROPOSED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "summary" VARCHAR(500),
    "policyVersion" VARCHAR(64) NOT NULL DEFAULT 'wave5.policy.v1',
    "createdByUserId" INTEGER,
    "approvedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_packages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_packages_orgId_status_updatedAt_idx" ON "decision_packages"("orgId", "status", "updatedAt");

ALTER TABLE "decision_packages" ADD CONSTRAINT "decision_packages_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_packages" ADD CONSTRAINT "decision_packages_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "decision_packages" ADD CONSTRAINT "decision_packages_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "decision_package_items" (
    "id" SERIAL NOT NULL,
    "decisionPackageId" INTEGER NOT NULL,
    "actionType" VARCHAR(64) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "evidenceJson" JSONB NOT NULL,
    "constraintsJson" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "state" "DecisionPackageItemState" NOT NULL DEFAULT 'OPEN',
    "targetRefs" JSONB,

    CONSTRAINT "decision_package_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_package_items_decisionPackageId_idx" ON "decision_package_items"("decisionPackageId");

ALTER TABLE "decision_package_items" ADD CONSTRAINT "decision_package_items_decisionPackageId_fkey"
  FOREIGN KEY ("decisionPackageId") REFERENCES "decision_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "decision_approval_events" (
    "id" SERIAL NOT NULL,
    "decisionPackageId" INTEGER NOT NULL,
    "eventType" "DecisionApprovalEventType" NOT NULL,
    "actorUserId" INTEGER,
    "comment" TEXT,
    "clientRequestId" VARCHAR(128),
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_approval_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_approval_events_decisionPackageId_createdAt_idx" ON "decision_approval_events"("decisionPackageId", "createdAt");
CREATE INDEX "decision_approval_events_decisionPackageId_clientRequestId_idx" ON "decision_approval_events"("decisionPackageId", "clientRequestId");

ALTER TABLE "decision_approval_events" ADD CONSTRAINT "decision_approval_events_decisionPackageId_fkey"
  FOREIGN KEY ("decisionPackageId") REFERENCES "decision_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_approval_events" ADD CONSTRAINT "decision_approval_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "scenario_runs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "templateKey" VARCHAR(64) NOT NULL,
    "parametersJson" JSONB NOT NULL,
    "horizonDays" INTEGER NOT NULL DEFAULT 28,
    "status" "ScenarioRunStatus" NOT NULL DEFAULT 'QUEUED',
    "engineVersion" VARCHAR(64) NOT NULL DEFAULT 'wave5.sim.v1',
    "inputsHash" VARCHAR(128),
    "baselineAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenario_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scenario_runs_orgId_status_createdAt_idx" ON "scenario_runs"("orgId", "status", "createdAt");
CREATE INDEX "scenario_runs_orgId_templateKey_createdAt_idx" ON "scenario_runs"("orgId", "templateKey", "createdAt");

ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "scenario_result_snapshots" (
    "id" SERIAL NOT NULL,
    "scenarioRunId" INTEGER NOT NULL,
    "outputsJson" JSONB NOT NULL,
    "driversJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_result_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scenario_result_snapshots_scenarioRunId_key" ON "scenario_result_snapshots"("scenarioRunId");

ALTER TABLE "scenario_result_snapshots" ADD CONSTRAINT "scenario_result_snapshots_scenarioRunId_fkey"
  FOREIGN KEY ("scenarioRunId") REFERENCES "scenario_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
