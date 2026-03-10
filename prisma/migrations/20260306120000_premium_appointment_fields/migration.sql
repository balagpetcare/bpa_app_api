-- Premium Appointment: add visitType, isInstant, isAnyDoctor, payment fields, channel, tokenNo; make doctorId nullable

-- Drop unique constraint (doctorId can be null for Any Doctor)
DROP INDEX IF EXISTS "appointments_doctorId_scheduledStartAt_scheduledEndAt_key";

-- Drop FK so we can alter doctorId to nullable; re-add with SET NULL
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_doctorId_fkey";
ALTER TABLE "appointments" ALTER COLUMN "doctorId" DROP NOT NULL;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add new columns
ALTER TABLE "appointments" ADD COLUMN "visitType" VARCHAR(20) NOT NULL DEFAULT 'WALK_IN';
ALTER TABLE "appointments" ADD COLUMN "isInstant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN "isAnyDoctor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointments" ADD COLUMN "paymentStatus" VARCHAR(16) NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "appointments" ADD COLUMN "paymentMethod" VARCHAR(32);
ALTER TABLE "appointments" ADD COLUMN "paidAmount" DECIMAL(12,2);
ALTER TABLE "appointments" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN "paidByUserId" INTEGER;
ALTER TABLE "appointments" ADD COLUMN "channel" VARCHAR(20) NOT NULL DEFAULT 'COUNTER';
ALTER TABLE "appointments" ADD COLUMN "tokenNo" VARCHAR(20);

-- Index for search by tokenNo
CREATE INDEX "appointments_branchId_tokenNo_idx" ON "appointments"("branchId", "tokenNo");
