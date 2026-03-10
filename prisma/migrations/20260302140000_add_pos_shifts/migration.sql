-- CreateEnum PosShiftStatus
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable pos_shifts
CREATE TABLE "pos_shifts" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "openedByUserId" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
    "startingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "closedByUserId" INTEGER,
    "managerOverrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pos_shifts_branchId_status_idx" ON "pos_shifts"("branchId", "status");
CREATE INDEX "pos_shifts_branchId_openedAt_idx" ON "pos_shifts"("branchId", "openedAt");

ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add posShiftId to orders
ALTER TABLE "orders" ADD COLUMN "posShiftId" INTEGER;
CREATE INDEX "orders_posShiftId_idx" ON "orders"("posShiftId");
ALTER TABLE "orders" ADD CONSTRAINT "orders_posShiftId_fkey" FOREIGN KEY ("posShiftId") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add POS_SHIFT to AuditEntityType
ALTER TYPE "AuditEntityType" ADD VALUE 'POS_SHIFT';
