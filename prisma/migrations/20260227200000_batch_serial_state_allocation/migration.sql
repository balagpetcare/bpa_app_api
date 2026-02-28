-- CreateEnum
CREATE TYPE "BatchSerialAllocationActionType" AS ENUM ('PRINT', 'DOWNLOAD_EXPORT', 'EMAIL_EXPORT');

-- CreateEnum
CREATE TYPE "BatchSerialAllocationFileType" AS ENUM ('CSV', 'XLSX');

-- CreateTable
CREATE TABLE "batch_serial_states" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "lastAllocatedSerial" INTEGER NOT NULL DEFAULT 0,
    "allocatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_serial_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_serial_allocation_logs" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "startSerial" INTEGER NOT NULL,
    "endSerial" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "actionType" "BatchSerialAllocationActionType" NOT NULL,
    "fileType" "BatchSerialAllocationFileType",
    "targetEmail" TEXT,
    "allocatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_serial_allocation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batch_serial_states_batchId_key" ON "batch_serial_states"("batchId");

-- CreateIndex
CREATE INDEX "batch_serial_allocation_logs_batchId_idx" ON "batch_serial_allocation_logs"("batchId");

-- CreateIndex
CREATE INDEX "batch_serial_allocation_logs_allocatedByUserId_idx" ON "batch_serial_allocation_logs"("allocatedByUserId");

-- AddForeignKey
ALTER TABLE "batch_serial_states" ADD CONSTRAINT "batch_serial_states_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "auth_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_serial_allocation_logs" ADD CONSTRAINT "batch_serial_allocation_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "auth_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_serial_allocation_logs" ADD CONSTRAINT "batch_serial_allocation_logs_allocatedByUserId_fkey" FOREIGN KEY ("allocatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
