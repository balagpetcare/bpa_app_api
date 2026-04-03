-- Preserve fee change history when DoctorServiceFee rows are deleted (owner replace / doctor sync).
ALTER TABLE "doctor_service_fee_change_logs" DROP CONSTRAINT IF EXISTS "doctor_service_fee_change_logs_doctorServiceFeeId_fkey";

ALTER TABLE "doctor_service_fee_change_logs" ALTER COLUMN "doctorServiceFeeId" DROP NOT NULL;

ALTER TABLE "doctor_service_fee_change_logs"
  ADD CONSTRAINT "doctor_service_fee_change_logs_doctorServiceFeeId_fkey"
  FOREIGN KEY ("doctorServiceFeeId") REFERENCES "doctor_service_fees" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
