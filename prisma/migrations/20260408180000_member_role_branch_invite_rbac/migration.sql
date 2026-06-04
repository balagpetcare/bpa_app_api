-- Extend MemberRole for branch staff invites (add-only, non-destructive).
-- Idempotent: safe if enum values already exist (replay / multiple deploys).

DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'DOCTOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'CLINIC_STAFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'CLINIC_RECEPTION';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'CLINIC_INVENTORY_STAFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'PHARMACIST';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'GROOMING_STAFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'BOARDING_STAFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "MemberRole" ADD VALUE 'TRAINING_STAFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
