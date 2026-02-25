/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `donations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex (drop existing conflicting index first)
DROP INDEX IF EXISTS "donations_idempotencyKey_key";
CREATE UNIQUE INDEX "donations_idempotencyKey_key" ON "donations"("idempotencyKey");
