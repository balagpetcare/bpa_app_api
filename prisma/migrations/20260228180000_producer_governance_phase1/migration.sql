-- CreateEnum
CREATE TYPE "OrgQuotaResetPeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "actorRole" VARCHAR(64) NOT NULL,
    "actionKey" VARCHAR(128) NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(128),
    "orgId" INTEGER,
    "metadata" JSONB,
    "traceId" VARCHAR(128),
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_feature_flags" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_quotas" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "limit" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "resetPeriod" "OrgQuotaResetPeriod" NOT NULL DEFAULT 'DAILY',
    "updatedByUserId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_orgId_createdAt_idx" ON "audit_events"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_createdAt_idx" ON "audit_events"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_actionKey_createdAt_idx" ON "audit_events"("actionKey", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_traceId_idx" ON "audit_events"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "org_feature_flags_org_key_unique" ON "org_feature_flags"("producerOrgId", "key");

-- CreateIndex
CREATE INDEX "org_feature_flags_producerOrgId_idx" ON "org_feature_flags"("producerOrgId");

-- CreateIndex
CREATE INDEX "org_feature_flags_key_idx" ON "org_feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "org_quotas_org_key_unique" ON "org_quotas"("producerOrgId", "key");

-- CreateIndex
CREATE INDEX "org_quotas_producerOrgId_idx" ON "org_quotas"("producerOrgId");

-- CreateIndex
CREATE INDEX "org_quotas_key_idx" ON "org_quotas"("key");

-- CreateIndex
CREATE INDEX "org_quotas_resetPeriod_idx" ON "org_quotas"("resetPeriod");

-- AddForeignKey
ALTER TABLE "org_feature_flags" ADD CONSTRAINT "org_feature_flags_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_feature_flags" ADD CONSTRAINT "org_feature_flags_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_quotas" ADD CONSTRAINT "org_quotas_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_quotas" ADD CONSTRAINT "org_quotas_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
