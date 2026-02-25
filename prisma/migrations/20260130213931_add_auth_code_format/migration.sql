/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `donations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "donations_idempotencyKey_key" ON "donations"("idempotencyKey");
