-- Add additional verification fields for fundraising accounts
ALTER TABLE "fundraising_accounts"
  ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nationalIdNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "birthRegNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "studentIdNumber" TEXT;
