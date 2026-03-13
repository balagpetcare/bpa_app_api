-- Phase 2: Injection token cancel audit + medication administration bypass/approval linkage

-- AlterTable injection_tokens: cancel audit fields
ALTER TABLE "injection_tokens" ADD COLUMN "cancelledByUserId" INTEGER;
ALTER TABLE "injection_tokens" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "injection_tokens" ADD COLUMN "cancelReason" TEXT;

-- AlterTable medication_administrations: emergency bypass and approval link
ALTER TABLE "medication_administrations" ADD COLUMN "emergencyBypassReason" TEXT;
ALTER TABLE "medication_administrations" ADD COLUMN "medicineApprovalRequestId" INTEGER;

-- AddForeignKey injection_tokens -> users (cancelledBy)
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey medication_administrations -> medicine_approval_requests
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_medicineApprovalRequestId_fkey" FOREIGN KEY ("medicineApprovalRequestId") REFERENCES "medicine_approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
