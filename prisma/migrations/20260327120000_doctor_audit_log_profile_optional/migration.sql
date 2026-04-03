-- Make clinicStaffProfileId optional for fallback visit-completion audit when profile cannot be resolved
ALTER TABLE "doctor_audit_logs" ALTER COLUMN "clinicStaffProfileId" DROP NOT NULL;
