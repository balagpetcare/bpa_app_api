-- Quick appointment: DRAFT/PRE_BOOKED statuses, snapshot fields, optional patientId

-- Add new enum values to AppointmentStatus
ALTER TYPE "AppointmentStatus" ADD VALUE 'DRAFT';
ALTER TYPE "AppointmentStatus" ADD VALUE 'PRE_BOOKED';

-- Make patientId nullable (for quick-call pre-booking without registered owner)
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_patientId_fkey";
ALTER TABLE "appointments" ALTER COLUMN "patientId" DROP NOT NULL;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot fields for pre-registration (phone call) data
ALTER TABLE "appointments" ADD COLUMN "ownerNameSnapshot" VARCHAR(128);
ALTER TABLE "appointments" ADD COLUMN "mobileSnapshot" VARCHAR(20);
ALTER TABLE "appointments" ADD COLUMN "petNameSnapshot" VARCHAR(128);
ALTER TABLE "appointments" ADD COLUMN "petTypeSnapshot" VARCHAR(64);
ALTER TABLE "appointments" ADD COLUMN "appointmentMode" VARCHAR(20) NOT NULL DEFAULT 'STANDARD';
