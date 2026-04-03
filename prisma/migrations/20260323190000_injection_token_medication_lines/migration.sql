-- Walk-in visits may omit assigned doctor (injection-only / outside Rx administration).
ALTER TABLE "visits" ALTER COLUMN "doctorId" DROP NOT NULL;

-- Multi-medicine tokens: legacy columns optional; detail lives on injection_token_medication_lines.
ALTER TABLE "injection_tokens" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE "injection_tokens" ALTER COLUMN "expectedDose" DROP NOT NULL;

CREATE TABLE "injection_token_medication_lines" (
    "id" SERIAL NOT NULL,
    "injectionTokenId" INTEGER NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "medicineSource" "MedicineSource" NOT NULL,
    "variantId" INTEGER,
    "manualMedicineName" VARCHAR(512),
    "manualStrength" VARCHAR(256),
    "manualBatch" VARCHAR(256),
    "manualManufacturer" VARCHAR(256),
    "route" VARCHAR(64) NOT NULL,
    "expectedDose" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(32),
    "durationText" VARCHAR(128),
    "frequencyText" VARCHAR(128),
    "longevityNote" TEXT,
    "lineNote" TEXT,
    "selectedVialSessionId" INTEGER,
    "medicineFeeSnapshot" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "injection_token_medication_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "injection_token_medication_lines_injectionTokenId_lineIndex_key" ON "injection_token_medication_lines"("injectionTokenId", "lineIndex");
CREATE INDEX "injection_token_medication_lines_injectionTokenId_idx" ON "injection_token_medication_lines"("injectionTokenId");
CREATE INDEX "injection_token_medication_lines_variantId_idx" ON "injection_token_medication_lines"("variantId");

ALTER TABLE "injection_token_medication_lines" ADD CONSTRAINT "injection_token_medication_lines_injectionTokenId_fkey" FOREIGN KEY ("injectionTokenId") REFERENCES "injection_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "injection_token_medication_lines" ADD CONSTRAINT "injection_token_medication_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "injection_token_medication_lines" ADD CONSTRAINT "injection_token_medication_lines_selectedVialSessionId_fkey" FOREIGN KEY ("selectedVialSessionId") REFERENCES "vial_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
