-- Extend doctor schedule exceptions for enterprise availability management
DO $$
BEGIN
  ALTER TYPE "DoctorScheduleExceptionType" ADD VALUE IF NOT EXISTS 'LEAVE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DoctorScheduleExceptionType" ADD VALUE IF NOT EXISTS 'EMERGENCY_AVAILABLE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
