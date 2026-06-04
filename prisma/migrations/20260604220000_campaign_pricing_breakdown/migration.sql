-- Campaign package pricing breakdown (vaccine + service = total)
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "vaccineCost" DECIMAL(10,2);
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "serviceCharge" DECIMAL(10,2);
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "packageFeatures" JSONB NOT NULL DEFAULT '[]';
