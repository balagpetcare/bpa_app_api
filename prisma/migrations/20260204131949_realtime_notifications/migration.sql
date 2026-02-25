/*
  Warnings:

  - Made the column `priority` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `notifications` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "priority" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL;
