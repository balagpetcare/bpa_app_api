-- Add composite indexes for appointment queries to improve performance
-- These indexes support common query patterns: date-based lists, doctor schedules, and filtered lists

-- Index for date-based appointment lists (branchId, scheduledStartAt)
CREATE INDEX IF NOT EXISTS "appointments_branchId_scheduledStartAt_idx" ON "appointments"("branchId", "scheduledStartAt");

-- Index for doctor schedule queries (doctorId, scheduledStartAt)
CREATE INDEX IF NOT EXISTS "appointments_doctorId_scheduledStartAt_idx" ON "appointments"("doctorId", "scheduledStartAt");

-- Index for filtered appointment lists (branchId, status, scheduledStartAt)
CREATE INDEX IF NOT EXISTS "appointments_branchId_status_scheduledStartAt_idx" ON "appointments"("branchId", "status", "scheduledStartAt");
