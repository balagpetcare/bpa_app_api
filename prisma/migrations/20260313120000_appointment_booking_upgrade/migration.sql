-- Appointment Enterprise Booking: appointmentType, surgeryPackageId, durationMinutes, followUpFromId, snapshots, roomId, specialInstructions

-- Add new enum values to AppointmentSource
ALTER TYPE "AppointmentSource" ADD VALUE 'OWNER_PANEL';
ALTER TYPE "AppointmentSource" ADD VALUE 'DOCTOR_PANEL';
ALTER TYPE "AppointmentSource" ADD VALUE 'ONLINE_BOOKING';

-- Add new columns to appointments (all nullable or with default for backward compatibility)
ALTER TABLE "appointments" ADD COLUMN "appointmentType" VARCHAR(20) NOT NULL DEFAULT 'CONSULTATION';
ALTER TABLE "appointments" ADD COLUMN "surgeryPackageId" INTEGER;
ALTER TABLE "appointments" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "appointments" ADD COLUMN "followUpFromId" INTEGER;
ALTER TABLE "appointments" ADD COLUMN "specialInstructions" TEXT;
ALTER TABLE "appointments" ADD COLUMN "priceSnapshot" JSONB;
ALTER TABLE "appointments" ADD COLUMN "packageSnapshot" JSONB;
ALTER TABLE "appointments" ADD COLUMN "doctorSnapshot" JSONB;
ALTER TABLE "appointments" ADD COLUMN "discountSnapshot" JSONB;
ALTER TABLE "appointments" ADD COLUMN "roomId" INTEGER;

-- Add foreign key constraints
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_surgeryPackageId_fkey" FOREIGN KEY ("surgeryPackageId") REFERENCES "surgery_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_followUpFromId_fkey" FOREIGN KEY ("followUpFromId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "branch_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create indexes for new columns
CREATE INDEX "appointments_appointmentType_idx" ON "appointments"("appointmentType");
CREATE INDEX "appointments_surgeryPackageId_idx" ON "appointments"("surgeryPackageId");
CREATE INDEX "appointments_followUpFromId_idx" ON "appointments"("followUpFromId");
