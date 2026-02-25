/*
  Warnings:

  - The primary key for the `user_location_profiles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId]` on the table `user_location_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "users_currentPlaceId_idx";

-- AlterTable
ALTER TABLE "access_invites" ALTER COLUMN "email" SET DATA TYPE TEXT,
ALTER COLUMN "displayName" SET DATA TYPE TEXT,
ALTER COLUMN "tokenHash" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "fundraising_accounts" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "cityName" TEXT,
ADD COLUMN     "countryName" TEXT,
ADD COLUMN     "formattedAddress" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "stateName" TEXT;

-- AlterTable
ALTER TABLE "policy_rules" ALTER COLUMN "ruleKey" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "state_policies" ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "state_policy_features" ALTER COLUMN "featureCode" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "state_policy_rules" ALTER COLUMN "ruleKey" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "states" ALTER COLUMN "code" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "user_location_profiles" DROP CONSTRAINT "user_location_profiles_pkey";

-- CreateIndex
CREATE UNIQUE INDEX "user_location_profiles_userId_key" ON "user_location_profiles"("userId");
