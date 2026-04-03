-- Add surgeryCaseId to inventory_consumptions for surgery consumables (Phase 2)
ALTER TABLE "inventory_consumptions" ADD COLUMN "surgeryCaseId" INTEGER;

CREATE INDEX "inventory_consumptions_surgeryCaseId_idx" ON "inventory_consumptions"("surgeryCaseId");

ALTER TABLE "inventory_consumptions" ADD CONSTRAINT "inventory_consumptions_surgeryCaseId_fkey" FOREIGN KEY ("surgeryCaseId") REFERENCES "surgery_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
