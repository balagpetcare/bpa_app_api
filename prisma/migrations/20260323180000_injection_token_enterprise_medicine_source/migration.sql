-- Enterprise MedicineSource rename (PostgreSQL 10+)
ALTER TYPE "MedicineSource" RENAME VALUE 'INTERNAL' TO 'INTERNAL_CLINIC';
ALTER TYPE "MedicineSource" RENAME VALUE 'OUTSIDE' TO 'OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT';
ALTER TYPE "MedicineSource" RENAME VALUE 'EXTERNAL' TO 'CLINIC_PROVIDED_MEDICINE';

ALTER TABLE "injection_tokens" ALTER COLUMN "medicineSource" SET DEFAULT 'INTERNAL_CLINIC'::"MedicineSource";
ALTER TABLE "medication_administrations" ALTER COLUMN "medicineSource" SET DEFAULT 'INTERNAL_CLINIC'::"MedicineSource";

CREATE TYPE "InjectionEncounterKind" AS ENUM ('INTERNAL_VISIT', 'EXTERNAL_WALK_IN');

ALTER TABLE "injection_tokens" ADD COLUMN "encounterKind" "InjectionEncounterKind" NOT NULL DEFAULT 'INTERNAL_VISIT';
ALTER TABLE "injection_tokens" ADD COLUMN "externalPrescriberName" VARCHAR(256);
ALTER TABLE "injection_tokens" ADD COLUMN "externalPrescriberClinic" VARCHAR(256);
ALTER TABLE "injection_tokens" ADD COLUMN "externalRxNotes" TEXT;
ALTER TABLE "injection_tokens" ADD COLUMN "externalRxEvidenceUrl" TEXT;
ALTER TABLE "injection_tokens" ADD COLUMN "serviceChargeAmount" DECIMAL(12, 2);
ALTER TABLE "injection_tokens" ADD COLUMN "medicineChargeAmount" DECIMAL(12, 2);
ALTER TABLE "injection_tokens" ADD COLUMN "consumablesChargeAmount" DECIMAL(12, 2);
