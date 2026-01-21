-- Fundraising V2: account profile fields + campaign category/location

-- CreateEnum
CREATE TYPE "FundraisingAccountType" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');

-- fundraising_accounts: add verification profile fields
ALTER TABLE "fundraising_accounts" ADD COLUMN "accountType" "FundraisingAccountType";
ALTER TABLE "fundraising_accounts" ADD COLUMN "permanentAddress" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "presentAddress" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "occupation" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "area" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "rescueSinceYear" INTEGER;
ALTER TABLE "fundraising_accounts" ADD COLUMN "orgName" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "orgDescription" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "orgWorkType" TEXT;
ALTER TABLE "fundraising_accounts" ADD COLUMN "submittedAt" TIMESTAMP(3);

-- fundraising_campaigns: add category + location
ALTER TABLE "fundraising_campaigns" ADD COLUMN "category" TEXT;
ALTER TABLE "fundraising_campaigns" ADD COLUMN "locationText" TEXT;

-- Optional indexes for filtering
CREATE INDEX IF NOT EXISTS "fundraising_campaigns_category_idx" ON "fundraising_campaigns"("category");
