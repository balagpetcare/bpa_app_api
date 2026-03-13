-- MedicinePolicy: minimum remaining threshold (e.g. 10%) to block use below threshold
ALTER TABLE "medicine_policies" ADD COLUMN IF NOT EXISTS "minRemainingPercent" INTEGER;
