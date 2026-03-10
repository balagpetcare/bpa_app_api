-- Add clinic-related fields to pets: unique Pet ID (QR), health card, allergies
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "uniquePetId" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "qrCodeUrl" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "allergies" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "bloodType" TEXT;
ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "healthCardJson" JSONB DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "pets_uniquePetId_key" ON "pets"("uniquePetId");
