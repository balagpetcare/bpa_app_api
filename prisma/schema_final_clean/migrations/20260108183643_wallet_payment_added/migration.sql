-- CreateEnum
CREATE TYPE "WalletSourceType" AS ENUM ('DONATION', 'FUNDRAISING_WITHDRAW_REQUEST', 'ADMIN_ADJUSTMENT');

-- AlterTable
ALTER TABLE "user_wallets" ADD COLUMN     "availableBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "lockedBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "pendingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "sourceId" INTEGER,
ADD COLUMN     "sourceType" "WalletSourceType";

-- CreateIndex
CREATE INDEX "wallet_transactions_sourceType_sourceId_idx" ON "wallet_transactions"("sourceType", "sourceId");
