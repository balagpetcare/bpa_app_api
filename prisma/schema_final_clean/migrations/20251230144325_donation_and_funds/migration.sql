-- CreateEnum
CREATE TYPE "PostCategory" AS ENUM ('GENERAL', 'FUNDRAISING');

-- CreateEnum
CREATE TYPE "FundraisingAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FundraisingCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "category" "PostCategory" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "fundraising_accounts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "FundraisingAccountStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_verification_documents" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_campaigns" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "FundraisingCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_campaign_stats" (
    "campaignId" INTEGER NOT NULL,
    "raisedAmount" INTEGER NOT NULL DEFAULT 0,
    "donorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastDonationAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_campaign_stats_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "donorId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_accounts_userId_key" ON "fundraising_accounts"("userId");

-- CreateIndex
CREATE INDEX "fundraising_verification_documents_accountId_idx" ON "fundraising_verification_documents"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_campaigns_postId_key" ON "fundraising_campaigns"("postId");

-- CreateIndex
CREATE INDEX "fundraising_campaigns_accountId_createdAt_idx" ON "fundraising_campaigns"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "donations_campaignId_createdAt_idx" ON "donations"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "donations_donorId_idx" ON "donations"("donorId");

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_verification_documents" ADD CONSTRAINT "fundraising_verification_documents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_verification_documents" ADD CONSTRAINT "fundraising_verification_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaign_stats" ADD CONSTRAINT "fundraising_campaign_stats_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
