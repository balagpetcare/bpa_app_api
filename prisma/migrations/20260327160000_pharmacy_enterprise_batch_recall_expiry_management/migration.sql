-- CreateEnum
CREATE TYPE "RecallSeverity" AS ENUM ('STANDARD', 'URGENT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'RESOLVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "location_variant_configs" ADD COLUMN "minStock" INTEGER,
ADD COLUMN "maxStock" INTEGER,
ADD COLUMN "reorderPoint" INTEGER;

-- CreateTable
CREATE TABLE "batch_recalls" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "severity" "RecallSeverity" NOT NULL DEFAULT 'STANDARD',
    "status" "RecallStatus" NOT NULL DEFAULT 'ACTIVE',
    "initiatedById" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expiry_write_off_logs" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'AUTO',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expiry_write_off_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batch_recalls_orgId_status_idx" ON "batch_recalls"("orgId", "status");

-- CreateIndex
CREATE INDEX "batch_recalls_lotId_idx" ON "batch_recalls"("lotId");

-- CreateIndex
CREATE INDEX "batch_recalls_severity_status_idx" ON "batch_recalls"("severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expiry_write_off_logs_ledgerId_key" ON "expiry_write_off_logs"("ledgerId");

-- CreateIndex
CREATE INDEX "expiry_write_off_logs_orgId_createdAt_idx" ON "expiry_write_off_logs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "expiry_write_off_logs_lotId_idx" ON "expiry_write_off_logs"("lotId");

-- CreateIndex
CREATE INDEX "expiry_write_off_logs_locationId_createdAt_idx" ON "expiry_write_off_logs"("locationId", "createdAt");

-- AddForeignKey
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_recalls" ADD CONSTRAINT "batch_recalls_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "stock_ledgers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_write_off_logs" ADD CONSTRAINT "expiry_write_off_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
