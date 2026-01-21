-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('BKASH', 'NAGAD', 'ROCKET');

-- CreateEnum
CREATE TYPE "WalletWithdrawRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'QUEUED', 'PROCESSING', 'TRANSFERRED', 'FAILED', 'REJECTED', 'CANCELED');

-- AlterEnum
ALTER TYPE "WalletSourceType" ADD VALUE 'WALLET_WITHDRAW_REQUEST';

-- CreateTable
CREATE TABLE "wallet_withdraw_requests" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "payoutDetailsJson" TEXT NOT NULL,
    "provider" "PayoutProvider",
    "providerPayoutId" TEXT,
    "providerStatus" TEXT,
    "providerResponseJson" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "WalletWithdrawRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "adminUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_event_logs" (
    "id" SERIAL NOT NULL,
    "provider" "PayoutProvider" NOT NULL,
    "providerEventId" TEXT,
    "providerPayoutId" TEXT,
    "withdrawRequestId" INTEGER,
    "payloadJson" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_walletId_createdAt_idx" ON "wallet_withdraw_requests"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_userId_createdAt_idx" ON "wallet_withdraw_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_status_createdAt_idx" ON "wallet_withdraw_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_adminUserId_idx" ON "wallet_withdraw_requests"("adminUserId");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_provider_providerPayoutId_idx" ON "wallet_withdraw_requests"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "payout_event_logs_provider_providerEventId_idx" ON "payout_event_logs"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payout_event_logs_provider_providerPayoutId_idx" ON "payout_event_logs"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "payout_event_logs_withdrawRequestId_idx" ON "payout_event_logs"("withdrawRequestId");

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "user_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_event_logs" ADD CONSTRAINT "payout_event_logs_withdrawRequestId_fkey" FOREIGN KEY ("withdrawRequestId") REFERENCES "wallet_withdraw_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
