-- Phase 4: GovernanceIncident model for enforcement audit
CREATE TABLE "governance_incidents" (
    "id" SERIAL NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" INTEGER NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "incidentType" VARCHAR(64) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "actionTaken" VARCHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketId" VARCHAR(128),
    "createdByUserId" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" INTEGER,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "governance_incidents_producerOrgId_idx" ON "governance_incidents"("producerOrgId");
CREATE INDEX "governance_incidents_entityType_entityId_idx" ON "governance_incidents"("entityType", "entityId");
CREATE INDEX "governance_incidents_incidentType_idx" ON "governance_incidents"("incidentType");

ALTER TABLE "governance_incidents" ADD CONSTRAINT "governance_incidents_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
