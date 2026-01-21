-- AlterTable
ALTER TABLE "achievements" ADD COLUMN     "howTo" TEXT,
ADD COLUMN     "requiredPoints" INTEGER NOT NULL DEFAULT 0;
