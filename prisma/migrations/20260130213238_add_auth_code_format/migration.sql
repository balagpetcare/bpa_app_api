/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `donations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "AuthCodeStatus" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "auth_codes" ADD COLUMN     "codeLength" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "customPrefix" TEXT,
ADD COLUMN     "customSuffix" TEXT;

-- CreateIndex
CREATE INDEX "auth_codes_status_idx" ON "auth_codes"("status");

-- CreateIndex (idempotent for existing DBs)
CREATE UNIQUE INDEX IF NOT EXISTS "donations_idempotencyKey_key" ON "donations"("idempotencyKey");
