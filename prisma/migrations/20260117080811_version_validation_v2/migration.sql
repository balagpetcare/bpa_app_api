/*
  Warnings:

  - You are about to drop the column `lockedAt` on the `verification_cases` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "verification_cases" DROP COLUMN "lockedAt",
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;
