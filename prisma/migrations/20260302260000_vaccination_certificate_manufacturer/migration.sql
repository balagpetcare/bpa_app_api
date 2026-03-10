ALTER TABLE "vaccinations" ADD COLUMN IF NOT EXISTS "manufacturer" VARCHAR(128);
ALTER TABLE "vaccinations" ADD COLUMN IF NOT EXISTS "certificateToken" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "vaccinations_certificateToken_key" ON "vaccinations"("certificateToken");
CREATE INDEX IF NOT EXISTS "vaccinations_petId_idx" ON "vaccinations"("petId");
CREATE INDEX IF NOT EXISTS "vaccinations_nextDueDate_idx" ON "vaccinations"("nextDueDate");
