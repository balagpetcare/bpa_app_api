-- CreateTable: sterilization_cycles
CREATE TABLE IF NOT EXISTS "sterilization_cycles" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "cycleNo" VARCHAR(32) NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "machineName" VARCHAR(128),
    "operatorId" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "remarks" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sterilization_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sterilization_cycles_cycleNo_key" ON "sterilization_cycles"("cycleNo");
CREATE INDEX IF NOT EXISTS "sterilization_cycles_orgId_idx" ON "sterilization_cycles"("orgId");
CREATE INDEX IF NOT EXISTS "sterilization_cycles_branchId_idx" ON "sterilization_cycles"("branchId");
CREATE INDEX IF NOT EXISTS "sterilization_cycles_status_idx" ON "sterilization_cycles"("status");

ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: sterilization_cycle_items
CREATE TABLE IF NOT EXISTS "sterilization_cycle_items" (
    "id" SERIAL NOT NULL,
    "cycleId" INTEGER NOT NULL,
    "instrumentId" INTEGER NOT NULL,
    "preCleanStatus" VARCHAR(32) NOT NULL,
    "postCycleStatus" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sterilization_cycle_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sterilization_cycle_items_cycleId_idx" ON "sterilization_cycle_items"("cycleId");
CREATE INDEX IF NOT EXISTS "sterilization_cycle_items_instrumentId_idx" ON "sterilization_cycle_items"("instrumentId");

ALTER TABLE "sterilization_cycle_items" ADD CONSTRAINT "sterilization_cycle_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "sterilization_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sterilization_cycle_items" ADD CONSTRAINT "sterilization_cycle_items_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: instrument_instances
CREATE TABLE IF NOT EXISTS "instrument_instances" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "serialNo" VARCHAR(64),
    "conditionStatus" VARCHAR(24) NOT NULL DEFAULT 'GOOD',
    "sterilizationStatus" VARCHAR(24) NOT NULL DEFAULT 'NOT_APPLICABLE',
    "lastSterilizedAt" TIMESTAMP(3),
    "sterilizationExpiryAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "purchasedAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "instrument_instances_orgId_idx" ON "instrument_instances"("orgId");
CREATE INDEX IF NOT EXISTS "instrument_instances_branchId_idx" ON "instrument_instances"("branchId");
CREATE INDEX IF NOT EXISTS "instrument_instances_clinicalItemId_idx" ON "instrument_instances"("clinicalItemId");

ALTER TABLE "instrument_instances" ADD CONSTRAINT "instrument_instances_clinicalItemId_fkey" FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instrument_instances" ADD CONSTRAINT "instrument_instances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instrument_instances" ADD CONSTRAINT "instrument_instances_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
