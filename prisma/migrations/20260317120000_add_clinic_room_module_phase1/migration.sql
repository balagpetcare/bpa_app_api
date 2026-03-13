-- AlterTable branch_rooms: add Phase 1 Clinic Room Module fields
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "code" VARCHAR(32);
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "floor" VARCHAR(32);
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "zone" VARCHAR(64);
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "operationalStatus" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "bookable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "cleaningBufferMinutes" INTEGER;
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "maintenanceBufferMinutes" INTEGER;
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "supportsWalkIns" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "emergencyOverrideAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "preferredDoctorIds" JSONB DEFAULT '[]';
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "allowedServiceIds" JSONB DEFAULT '[]';
ALTER TABLE "branch_rooms" ADD COLUMN IF NOT EXISTS "allowedPackageIds" JSONB DEFAULT '[]';

-- Unique on (branchId, code): multiple NULL code allowed in PostgreSQL
CREATE UNIQUE INDEX "branch_rooms_branchId_code_key" ON "branch_rooms"("branchId", "code");
CREATE INDEX IF NOT EXISTS "branch_rooms_branchId_operationalStatus_idx" ON "branch_rooms"("branchId", "operationalStatus");

-- CreateTable clinic_room_blocks
CREATE TABLE IF NOT EXISTS "clinic_room_blocks" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "roomId" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_room_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clinic_room_blocks_branchId_roomId_idx" ON "clinic_room_blocks"("branchId", "roomId");
CREATE INDEX IF NOT EXISTS "clinic_room_blocks_roomId_startAt_endAt_idx" ON "clinic_room_blocks"("roomId", "startAt", "endAt");

ALTER TABLE "clinic_room_blocks" ADD CONSTRAINT "clinic_room_blocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_room_blocks" ADD CONSTRAINT "clinic_room_blocks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "branch_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_room_blocks" ADD CONSTRAINT "clinic_room_blocks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable services: allowed room types for compatibility
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "allowedRoomTypes" JSONB DEFAULT '[]';

-- AlterTable surgery_packages: allowed room types for compatibility
ALTER TABLE "surgery_packages" ADD COLUMN IF NOT EXISTS "allowedRoomTypes" JSONB DEFAULT '[]';
