-- Injection Token + Daily Reconciliation

-- CreateEnum
CREATE TYPE "InjectionTokenStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MedicineSource" AS ENUM ('INTERNAL', 'EXTERNAL', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'RECONCILED', 'FLAGGED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "injection_tokens" (
    "id" SERIAL NOT NULL,
    "tokenCode" VARCHAR(32) NOT NULL,
    "branchId" INTEGER NOT NULL,
    "visitId" INTEGER NOT NULL,
    "prescriptionId" INTEGER,
    "orderId" INTEGER,
    "patientId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "expectedDose" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(32),
    "medicineSource" "MedicineSource" NOT NULL DEFAULT 'INTERNAL',
    "status" "InjectionTokenStatus" NOT NULL DEFAULT 'PENDING',
    "generatedByUserId" INTEGER NOT NULL,
    "usedByUserId" INTEGER,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "injection_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reconciliations" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "reconciliationDate" DATE NOT NULL,
    "totalInjections" INTEGER NOT NULL DEFAULT 0,
    "totalMlUsed" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "vialsOpened" INTEGER NOT NULL DEFAULT 0,
    "vialsClosed" INTEGER NOT NULL DEFAULT 0,
    "expectedVialsConsumed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalBillingCollected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tokensGenerated" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "tokensUnused" INTEGER NOT NULL DEFAULT 0,
    "hasMismatch" BOOLEAN NOT NULL DEFAULT false,
    "mismatchDetails" JSONB,
    "reconciledByUserId" INTEGER,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reconciliations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "medication_administrations" ADD COLUMN "injectionTokenId" INTEGER;
ALTER TABLE "medication_administrations" ADD COLUMN "medicineSource" "MedicineSource" NOT NULL DEFAULT 'INTERNAL';

-- CreateIndex
CREATE UNIQUE INDEX "injection_tokens_tokenCode_key" ON "injection_tokens"("tokenCode");
CREATE INDEX "injection_tokens_branchId_idx" ON "injection_tokens"("branchId");
CREATE INDEX "injection_tokens_visitId_idx" ON "injection_tokens"("visitId");
CREATE INDEX "injection_tokens_prescriptionId_idx" ON "injection_tokens"("prescriptionId");
CREATE INDEX "injection_tokens_orderId_idx" ON "injection_tokens"("orderId");
CREATE INDEX "injection_tokens_patientId_idx" ON "injection_tokens"("patientId");
CREATE INDEX "injection_tokens_petId_idx" ON "injection_tokens"("petId");
CREATE INDEX "injection_tokens_variantId_idx" ON "injection_tokens"("variantId");
CREATE INDEX "injection_tokens_status_idx" ON "injection_tokens"("status");
CREATE INDEX "injection_tokens_createdAt_idx" ON "injection_tokens"("createdAt");
CREATE INDEX "injection_tokens_expiresAt_idx" ON "injection_tokens"("expiresAt");

CREATE UNIQUE INDEX "daily_reconciliations_branchId_reconciliationDate_key" ON "daily_reconciliations"("branchId", "reconciliationDate");
CREATE INDEX "daily_reconciliations_branchId_idx" ON "daily_reconciliations"("branchId");
CREATE INDEX "daily_reconciliations_reconciliationDate_idx" ON "daily_reconciliations"("reconciliationDate");
CREATE INDEX "daily_reconciliations_status_idx" ON "daily_reconciliations"("status");
CREATE INDEX "daily_reconciliations_hasMismatch_idx" ON "daily_reconciliations"("hasMismatch");

CREATE UNIQUE INDEX "medication_administrations_injectionTokenId_key" ON "medication_administrations"("injectionTokenId");
CREATE INDEX "medication_administrations_medicineSource_idx" ON "medication_administrations"("medicineSource");

-- AddForeignKey
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_reconciledByUserId_fkey" FOREIGN KEY ("reconciledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_injectionTokenId_fkey" FOREIGN KEY ("injectionTokenId") REFERENCES "injection_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
