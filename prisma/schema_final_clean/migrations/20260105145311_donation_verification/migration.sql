/*
  Warnings:

  - You are about to drop the column `birthRegNumber` on the `fundraising_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `dateOfBirth` on the `fundraising_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `nationalIdNumber` on the `fundraising_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `studentIdNumber` on the `fundraising_accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "fundraising_accounts" DROP COLUMN "birthRegNumber",
DROP COLUMN "dateOfBirth",
DROP COLUMN "nationalIdNumber",
DROP COLUMN "studentIdNumber";
