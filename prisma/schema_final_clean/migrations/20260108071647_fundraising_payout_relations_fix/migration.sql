-- CreateEnum
CREATE TYPE "PayoutMethodType" AS ENUM ('MFS', 'BANK');

-- CreateEnum
CREATE TYPE "FundraisingWithdrawRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'TRANSFERRED', 'REJECTED', 'CANCELED');

-- AlterTable
ALTER TABLE "fundraising_campaign_stats" ADD COLUMN     "lastPayoutAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fundraising_payout_method_catalog" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PayoutMethodType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requirementsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fundraising_payout_method_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_payout_methods" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "catalogId" INTEGER NOT NULL,
    "label" TEXT,
    "detailsJson" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_withdraw_requests" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "methodId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "FundraisingWithdrawRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "adminUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_payout_transfer_logs" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "reference" TEXT,
    "proofMediaId" INTEGER,
    "methodSnapshotJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundraising_payout_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_payout_method_catalog_code_key" ON "fundraising_payout_method_catalog"("code");

-- CreateIndex
CREATE INDEX "fundraising_payout_method_catalog_isActive_idx" ON "fundraising_payout_method_catalog"("isActive");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_accountId_idx" ON "fundraising_payout_methods"("accountId");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_catalogId_idx" ON "fundraising_payout_methods"("catalogId");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_isDefault_idx" ON "fundraising_payout_methods"("isDefault");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_campaignId_createdAt_idx" ON "fundraising_withdraw_requests"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_accountId_createdAt_idx" ON "fundraising_withdraw_requests"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_status_createdAt_idx" ON "fundraising_withdraw_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_adminUserId_idx" ON "fundraising_withdraw_requests"("adminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_payout_transfer_logs_requestId_key" ON "fundraising_payout_transfer_logs"("requestId");

-- CreateIndex
CREATE INDEX "fundraising_payout_transfer_logs_proofMediaId_idx" ON "fundraising_payout_transfer_logs"("proofMediaId");

-- AddForeignKey
ALTER TABLE "fundraising_payout_methods" ADD CONSTRAINT "fundraising_payout_methods_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_methods" ADD CONSTRAINT "fundraising_payout_methods_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "fundraising_payout_method_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "fundraising_payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_transfer_logs" ADD CONSTRAINT "fundraising_payout_transfer_logs_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "fundraising_withdraw_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_transfer_logs" ADD CONSTRAINT "fundraising_payout_transfer_logs_proofMediaId_fkey" FOREIGN KEY ("proofMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
