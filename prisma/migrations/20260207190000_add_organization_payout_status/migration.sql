-- CreateEnum
CREATE TYPE "OrganizationPayoutStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING_APPROVAL', 'CONFIGURED', 'REJECTED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "payoutStatus" "OrganizationPayoutStatus" NOT NULL DEFAULT 'NOT_CONFIGURED';
