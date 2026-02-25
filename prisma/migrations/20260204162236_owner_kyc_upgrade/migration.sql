-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'OWNER_KYC_SUBMITTED';

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "owner_kyc" ADD COLUMN     "businessIntentJson" JSONB,
ADD COLUMN     "declarationsJson" JSONB,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "kycLevel" INTEGER DEFAULT 0;

-- CreateIndex
CREATE INDEX "organizations_deletedAt_deletionScheduledAt_idx" ON "organizations"("deletedAt", "deletionScheduledAt");

-- CreateIndex
CREATE INDEX "owner_kyc_expiresAt_idx" ON "owner_kyc"("expiresAt");
