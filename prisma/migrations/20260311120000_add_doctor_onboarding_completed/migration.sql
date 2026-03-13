-- AlterTable: Add profile-level onboarding flag to doctor_verifications.
-- Per-clinic onboarding (ClinicStaffProfile.onboardingStatus) does NOT drive redirect.
ALTER TABLE "doctor_verifications" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
-- Backfill: doctors already VERIFIED can access dashboard without redirect.
UPDATE "doctor_verifications" SET "onboardingCompleted" = true WHERE "verificationStatus" = 'VERIFIED';
