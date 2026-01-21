/*
  Warnings:

  - The values [REQUIRED,OPTIONAL] on the enum `DocumentStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [REQUEST_CHANGES,SUSPEND,UNSUSPEND] on the enum `VerificationAction` will be removed. If these variants are still used in the database, this will fail.
  - The values [REQUEST_CHANGES,SUSPENDED] on the enum `VerificationStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "DocumentStatus_new" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');
ALTER TABLE "branch_documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "org_documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "owner_kyc_documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "owner_kyc_documents" ALTER COLUMN "status" TYPE "DocumentStatus_new" USING ("status"::text::"DocumentStatus_new");
ALTER TABLE "org_documents" ALTER COLUMN "status" TYPE "DocumentStatus_new" USING ("status"::text::"DocumentStatus_new");
ALTER TABLE "branch_documents" ALTER COLUMN "status" TYPE "DocumentStatus_new" USING ("status"::text::"DocumentStatus_new");
ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";
ALTER TYPE "DocumentStatus_new" RENAME TO "DocumentStatus";
DROP TYPE "DocumentStatus_old";
ALTER TABLE "branch_documents" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
ALTER TABLE "org_documents" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
ALTER TABLE "owner_kyc_documents" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "VerificationAction_new" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'NOTE', 'LOCK', 'UNLOCK');
ALTER TABLE "verification_logs" ALTER COLUMN "action" TYPE "VerificationAction_new" USING ("action"::text::"VerificationAction_new");
ALTER TYPE "VerificationAction" RENAME TO "VerificationAction_old";
ALTER TYPE "VerificationAction_new" RENAME TO "VerificationAction";
DROP TYPE "VerificationAction_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "VerificationStatus_new" AS ENUM ('UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');
ALTER TABLE "branch_profile_details" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "branches" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "org_legal_profiles" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "owner_kyc" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "owner_kyc" ALTER COLUMN "verificationStatus" TYPE "VerificationStatus_new" USING ("verificationStatus"::text::"VerificationStatus_new");
ALTER TABLE "org_legal_profiles" ALTER COLUMN "verificationStatus" TYPE "VerificationStatus_new" USING ("verificationStatus"::text::"VerificationStatus_new");
ALTER TABLE "branch_profile_details" ALTER COLUMN "verificationStatus" TYPE "VerificationStatus_new" USING ("verificationStatus"::text::"VerificationStatus_new");
ALTER TABLE "verification_logs" ALTER COLUMN "fromStatus" TYPE "VerificationStatus_new" USING ("fromStatus"::text::"VerificationStatus_new");
ALTER TABLE "verification_logs" ALTER COLUMN "toStatus" TYPE "VerificationStatus_new" USING ("toStatus"::text::"VerificationStatus_new");
ALTER TABLE "branches" ALTER COLUMN "verificationStatus" TYPE "VerificationStatus_new" USING ("verificationStatus"::text::"VerificationStatus_new");
ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_old";
ALTER TYPE "VerificationStatus_new" RENAME TO "VerificationStatus";
DROP TYPE "VerificationStatus_old";
ALTER TABLE "branch_profile_details" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNSUBMITTED';
ALTER TABLE "branches" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNSUBMITTED';
ALTER TABLE "org_legal_profiles" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNSUBMITTED';
ALTER TABLE "owner_kyc" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNSUBMITTED';
COMMIT;

-- DropIndex
DROP INDEX "branch_documents_branchProfileId_type_mediaId_key";

-- DropIndex
DROP INDEX "org_documents_orgLegalProfileId_type_mediaId_key";

-- DropIndex
DROP INDEX "owner_kyc_documents_ownerKycId_type_key";

-- CreateIndex
CREATE INDEX "branch_profile_details_reviewedByAdminId_idx" ON "branch_profile_details"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "org_legal_profiles_reviewedByAdminId_idx" ON "org_legal_profiles"("reviewedByAdminId");
