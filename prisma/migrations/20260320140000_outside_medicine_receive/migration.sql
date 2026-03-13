-- Outside medicine: pharmacy verification (batch/expiry) before injection; cannot merge with clinic vial
CREATE TABLE IF NOT EXISTS "outside_medicine_receives" (
  "id" SERIAL NOT NULL,
  "branchId" INTEGER NOT NULL,
  "variantId" INTEGER NOT NULL,
  "batchCode" VARCHAR(128),
  "expiryDate" DATE,
  "receivedByUserId" INTEGER NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "outside_medicine_receives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outside_medicine_receives_branchId_idx" ON "outside_medicine_receives"("branchId");
CREATE INDEX IF NOT EXISTS "outside_medicine_receives_variantId_idx" ON "outside_medicine_receives"("variantId");
CREATE INDEX IF NOT EXISTS "outside_medicine_receives_receivedAt_idx" ON "outside_medicine_receives"("receivedAt");
CREATE INDEX IF NOT EXISTS "outside_medicine_receives_expiryDate_idx" ON "outside_medicine_receives"("expiryDate");

ALTER TABLE "outside_medicine_receives" ADD CONSTRAINT "outside_medicine_receives_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outside_medicine_receives" ADD CONSTRAINT "outside_medicine_receives_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outside_medicine_receives" ADD CONSTRAINT "outside_medicine_receives_receivedByUserId_fkey"
  FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
