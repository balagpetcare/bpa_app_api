-- CreateEnum
CREATE TYPE "BatchSerialAllocationStatus" AS ENUM ('ISSUED', 'REVOKED');

-- AlterTable batch_serial_allocation_logs: add status, revoke fields
ALTER TABLE "batch_serial_allocation_logs" ADD COLUMN "status" "BatchSerialAllocationStatus" NOT NULL DEFAULT 'ISSUED';
ALTER TABLE "batch_serial_allocation_logs" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "batch_serial_allocation_logs" ADD COLUMN "revokedByUserId" INTEGER;
ALTER TABLE "batch_serial_allocation_logs" ADD COLUMN "revokeReason" TEXT;

-- CreateIndex
CREATE INDEX "batch_serial_allocation_logs_revokedByUserId_idx" ON "batch_serial_allocation_logs"("revokedByUserId");

-- AddForeignKey
ALTER TABLE "batch_serial_allocation_logs" ADD CONSTRAINT "batch_serial_allocation_logs_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable auth_codes: add issuance fields
ALTER TABLE "auth_codes" ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "auth_codes" ADD COLUMN "issuedByUserId" INTEGER;
ALTER TABLE "auth_codes" ADD COLUMN "issuedMethod" "BatchSerialAllocationActionType";
ALTER TABLE "auth_codes" ADD COLUMN "issuedToEmail" TEXT;
ALTER TABLE "auth_codes" ADD COLUMN "issuedAllocationLogId" INTEGER;

-- CreateIndex
CREATE INDEX "auth_codes_issuedAllocationLogId_idx" ON "auth_codes"("issuedAllocationLogId");

-- AddForeignKey
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_issuedAllocationLogId_fkey" FOREIGN KEY ("issuedAllocationLogId") REFERENCES "batch_serial_allocation_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
